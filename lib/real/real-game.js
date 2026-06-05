/**
 * real-game.js — OItrainer "Real Mode" 主游戏控制器
 *
 * 负责管理游戏生命周期：初始化、周推进、行动执行、比赛调度、
 * 存档读写，以及协调所有子系统（训练、天赋、事件、预算、设施等）。
 *
 * 语法：ES5（var / function，无箭头函数，无 let/const）
 * 全局挂载：window.RealGame
 */
;(function () {
  'use strict';

  // ==================== 辅助工具 ====================

  /**
   * 生成不重复的学生姓名
   * 优先使用 window.generateUniqueName，若不可用则退化为 generateName + 去重
   */
  function _makeUniqueName(region, existingNames) {
    if (window.generateUniqueName) {
      return generateUniqueName({ region: region, existingNames: existingNames });
    }
    // 退化方案：循环生成直到不重复
    var name;
    var maxTries = 200;
    do {
      name = generateName({ region: region });
      maxTries--;
    } while (existingNames.indexOf(name) !== -1 && maxTries > 0);
    return name;
  }

  /**
   * 根据难度系数生成随机能力值
   */
  function _randomAbility(base, range, diffMod) {
    return Math.floor((base + Math.random() * range) * diffMod);
  }

  /**
   * 获取难度修正系数
   * difficulty 1 = 简单（+15%），2 = 普通，3 = 困难（-15%）
   */
  function _diffMod(difficulty) {
    if (difficulty === 1) return 1.15;
    if (difficulty === 3) return 0.85;
    return 1.0;
  }

  /**
   * 计算设施调整后的舒适度
   * 考虑宿舍、空调、食堂、天气等因素
   * @param {Object} state - 游戏状态
   * @returns {number} 调整后的舒适度（0-100）
   */
  function _getFacilityAdjustedComfort(state) {
    var f = state.facilities;
    if (!f) return state.base_comfort || 50;

    var comfort = state.base_comfort || 50;

    // 宿舍加成
    comfort += (typeof f.getDormComfortBonus === 'function') ? f.getDormComfortBonus() : 0;

    // 空调加成
    var acLevel = f.ac || 1;
    if (typeof AC_COMFORT_BONUS_PER_LEVEL !== 'undefined') {
      comfort += AC_COMFORT_BONUS_PER_LEVEL * (acLevel - 1);
    } else {
      comfort += 9 * (acLevel - 1);
    }

    // 食堂小幅加成
    var canteenLevel = f.canteen || 1;
    comfort += 3 * (canteenLevel - 1);

    // 天气惩罚
    var temp = state.temperature || 20;
    var isExtreme = (temp < 5 || temp > 35);
    if (isExtreme) {
      var penalty = 20;
      if (acLevel > 1) {
        penalty = 10;
      }
      comfort -= penalty;
    }

    return Math.max(0, Math.min(100, comfort));
  }

  // ==================== 主对象 ====================

  window.RealGame = {

    // ==================== 游戏状态 ====================
    // 纯对象，不使用 GameState 实例；所有运行时数据集中在此

    state: null,

    // ==================== 初始化 ====================

    /**
     * 初始化新游戏
     * @param {Object} config
     *   - difficulty      {number}  难度 1/2/3
     *   - provinceIndex   {number}  省份索引
     *   - studentCount    {number}  初始学生数
     *   - provinceName    {string}  省份名称
     *   - provinceType    {string}  省份类型（强省/弱省等）
     *   - seed            {number}  随机种子（可选）
     */
    init: function (config) {
      /* ---------- 设定随机种子 ---------- */
      if (config.seed && window.setRandomSeed) {
        setRandomSeed(config.seed);
      }

      /* ---------- 创建状态对象 ---------- */
      var dm = _diffMod(config.difficulty);
      var state = {
        // 基本信息
        week: 1,
        difficulty:           config.difficulty || 2,
        provinceIndex:        config.provinceIndex || 0,
        provinceName:         config.provinceName || '北京',
        provinceType:         config.provinceType || '强省',
        is_north:             config.is_north || false,

        // 学生列表
        students: [],

        // 教练信息
        reputation: 50,
        initial_students: 0,
        quit_students: 0,

        // 晋级链：{ contestId: Set<学生姓名> }
        qualification: {},

        // 已完成的比赛 ID 集合（格式: "contestId_week"）
        completedCompetitions: new Set(),

        // 比赛历史记录
        careerCompetitions: [],

        // 预算（BudgetManager 实例）
        budget: null,

        // 设施（Facilities 实例）
        facilities: null,

        // 事件日志
        eventLog: [],
        recentEvents: [],

        // 本周行动标记
        actionTakenThisWeek: false,

        // 模拟赛是否可用
        mockContestAvailable: true,

        // 游戏结束标志
        gameOver: false,
        gameOverReason: '',

        // 每周任务池
        weeklyTasks: [],

        // 统计
        totalMedals:  { gold: 0, silver: 0, bronze: 0 },
        totalPasses:  0,

        // 文化课平均
        academicAverage: 0,

        // 天气 / 温度
        weather: '晴',
        temperature: 20,
      };
      this.state = state;

      /* ---------- 初始化预算系统 ---------- */
      // 初始经费根据省份类型和难度（参考简化模式）
      // 基础：强省 ¥160,000，普通省 ¥80,000，弱省 ¥40,000
      // 难度修正（同简化模式）：简单 ×1.5，普通 ×1.0，困难 ×0.5
      var initialFundsByProvince = { '\u5f3a\u7701': 160000, '\u666e\u901a\u7701': 80000, '\u5f31\u7701': 40000 };
      var baseFunds = initialFundsByProvince[state.provinceType] || 80000;
      var budgetMultiplier = 1.0;
      if (state.difficulty === 1) {
        budgetMultiplier = (typeof EASY_MODE_BUDGET_MULTIPLIER !== 'undefined') ? EASY_MODE_BUDGET_MULTIPLIER : 1.5;
      } else if (state.difficulty === 3) {
        budgetMultiplier = (typeof HARD_MODE_BUDGET_MULTIPLIER !== 'undefined') ? HARD_MODE_BUDGET_MULTIPLIER : 0.5;
      }
      var initialFunds = Math.floor(baseFunds * budgetMultiplier);
      BudgetManager.init(initialFunds);
      state.budget = BudgetManager;

      /* ---------- 初始化天赋系统（注册默认天赋） ---------- */
      if (typeof TalentManager !== 'undefined' && typeof TalentManager.registerDefaultTalents === 'function') {
        try {
          // 简化模式中 registerDefaultTalents 需要 game 参数和随机函数
          // 真实模式提供一个轻量模拟即可
          var _mockGame = { week: 1, students: state.students, reputation: state.reputation };
          TalentManager.registerDefaultTalents(_mockGame, {
            uniform: function(a, b) { return a + Math.random() * (b - a); },
            uniformInt: function(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); },
            normal: function(m, s) { return m + (Math.random() + Math.random() + Math.random() - 1.5) * s; },
            clamp: function(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
          });
        } catch (e) {
          console.warn('registerDefaultTalents failed:', e);
        }
      }

      /* ---------- 设置 window.game 桥接（供 TalentManager 兼容使用） ---------- */
      // TalentManager 部分逻辑依赖 window.game（难度判断、省份名、周数等）
      // 真实模式不使用 window.game 作为主状态，但设置桥接确保天赋系统正常工作
      window.game = {
        week: state.week,
        difficulty: state.difficulty,
        province_name: state.provinceName,
        province_type: state.provinceType,
        reputation: state.reputation,
        students: state.students
      };

      /* ---------- 初始化设施 ---------- */
      state.facilities = new Facilities();

      /* ---------- 创建初始学生 ---------- */
      var count = config.studentCount || 5;
      for (var i = 0; i < count; i++) {
        var existingNames = state.students.map(function (s) { return s.name; });
        var name = _makeUniqueName(config.provinceName, existingNames);

        var thinking = _randomAbility(30, 50, dm);
        var coding   = _randomAbility(25, 45, dm);
        var mental   = _randomAbility(20, 40, dm);

        var student = new Student(name, thinking, coding, mental);

        // 分配性格（同时设置性别、体力、体质、文化课成绩）
        PersonalityManager.assignPersonalities(student);

        // 分配初始天赋
        if (TalentManager && TalentManager.assignInitialTalent) {
          TalentManager.assignInitialTalent(student);
        }

        state.students.push(student);
      }
      state.initial_students = count;

      /* ---------- 初始每周任务 ---------- */
      state.weeklyTasks = RealTraining.selectRandomTasks(6);

      /* ---------- 初始化事件管理器 ---------- */
      RealEventManager.init();

      /* ---------- 为所有比赛创建晋级集合 ---------- */
      for (var j = 0; j < REAL_CONTEST_SCHEDULE.length; j++) {
        state.qualification[REAL_CONTEST_SCHEDULE[j].id] = new Set();
      }

      /* ---------- 记录赛季2的晋级链基础ID映射 ---------- */
      state.season2QualBaseIds = ['CSP-S1-S2', 'CSP-S2-S2', 'NOIP-S2', '省选-S2', 'NOI-S2', 'CTT-S2', 'WC-S2', 'CTS-S2', 'IOI-S2'];

      /* ---------- 自动存档初始状态 ---------- */
      RealSaveManager.autoSave(this._serializeState());
    },

    // ==================== 周推进 ====================

    /**
     * 推进一周
     * @returns {string} 'ok' | 'contest_week' | 'game_over'
     */
    advanceWeek: function () {
      if (this.state.gameOver) return 'game_over';

      var state = this.state;
      var week  = state.week;

      /* --- 1. 检查本周是否有未完成的比赛（不阻塞推进，玩家可跳过比赛） --- */

      /* --- 2. 处理每周事件 --- */
      var events = RealEventManager.checkEvents(week);
      this._processEvents(events);

      /* --- 3. 学生周处理（体力恢复、压力恢复、天赋触发） --- */
      for (var i = 0; i < state.students.length; i++) {
        var s = state.students[i];

        // 生病中：跳过训练
        if (s.sick_weeks > 0) {
          s.sick_weeks--;
          continue;
        }

        // 体力恢复
        RealTraining.recoverStamina(s, 1);

        // 压力自然恢复：基础 5~7/周，舒适度高时额外加速
        var comfort = _getFacilityAdjustedComfort(state);
        var baseRecovery = 5 + Math.floor(Math.random() * 3); // 5~7
        var comfortBonus = Math.floor((comfort - 50) / 25);    // 舒适度>50时额外恢复
        var recovery = baseRecovery + Math.max(0, comfortBonus);
        s.pressure = Math.max(0, s.pressure - recovery);

        // burnout 计数器：压力低于 80 时重置
        if (s.pressure < 80) {
          s.burnout_weeks = 0;
        }

        // 天赋：week_start 触发（同时也触发 week_end 以兼容两个版本的天赋）
        if (s.triggerTalents) {
          s.triggerTalents('week_start', { week: week });
          s.triggerTalents('week_end', { week: week });
        }

        // 天赋丢失检查（高压时可能丢失天赋）
        if (TalentManager && TalentManager.checkAndHandleTalentLoss) {
          TalentManager.checkAndHandleTalentLoss(s);
        }
      }

      /* --- 4. 扣除设施维护费 & 周收入 --- */
      var maintenance = (state.facilities.getMaintenanceCost)
        ? state.facilities.getMaintenanceCost()
        : 500;
      BudgetManager.spend(maintenance, '设施维护费', week);
      BudgetManager.processWeeklyIncome(week, state.reputation);

      /* --- 5. 推进周数 --- */
      state.week++;

      // 清除台风标记（每周开始时重置）
      state.typhoonWeek = false;

      // 同步 window.game 桥接
      if (window.game) {
        window.game.week = state.week;
        window.game.students = state.students;
      }

      /* --- 6. 刷新每周任务 --- */
      state.weeklyTasks = RealTraining.selectRandomTasks(6);
      state.actionTakenThisWeek = false;

      /* --- 7. 更新天气 --- */
      this._updateWeather();

      /* --- 8. 自动存档 --- */
      RealSaveManager.autoSave(this._serializeState());

      /* --- 9. 检查结束条件 --- */
      if (this._checkEnding()) {
        return 'game_over';
      }

      /* --- 10. 检查下一周是否是比赛周 --- */
      var nextContests = RealCalendar.getContestsAtWeek(state.week);
      if (nextContests && nextContests.length > 0) {
        return 'contest_week';
      }

      return 'ok';
    },

    // ==================== 执行行动 ====================

    /**
     * 执行本周训练行动
     * @param {string}   actionName       行动名称
     * @param {Array}    selectedStudents  参与学生列表
     * @param {Object}   options          可选参数（intensity 等）
     * @returns {Object} {success, message, ...}
     */
    executeAction: function (actionName, selectedStudents, options) {
      if (this.state.gameOver) {
        return { success: false, message: '游戏已结束' };
      }
      if (this.state.actionTakenThisWeek) {
        return { success: false, message: '本周已执行过行动' };
      }

      var result = RealTraining.executeAction(actionName, selectedStudents, options);

      if (result.success) {
        this.state.actionTakenThisWeek = true;

        // 处理训练产生的子事件
        this._processActionEvents(result.events || []);

        // 检查天赋获取
        if (options && options.intensity) {
          var talentEvents = RealEventManager.checkTalentAcquisition(
            selectedStudents, options.intensity
          );
          for (var i = 0; i < talentEvents.length; i++) {
            this.state.recentEvents.push({
              week:   this.state.week,
              message: talentEvents[i].student + ' 获得了天赋「' + talentEvents[i].talent + '」！',
              type:   'talent',
            });
          }
        }

        // 添加行动总结事件
        if (result.summary) {
          this.state.recentEvents.push({
            week:   this.state.week,
            message: result.summary,
            type:   'action',
          });
        }

        // 自动存档
        RealSaveManager.autoSave(this._serializeState());
      }

      return result;
    },

    // ==================== 举行比赛 ====================

    /**
     * 举行正式比赛
     * @param {Object} contestDef        比赛定义（来自 REAL_CONTEST_SCHEDULE）
     * @param {Array}  selectedStudents  参赛学生列表
     * @returns {Object} RealContestSimulator 实例
     */
    holdContest: function (contestDef, selectedStudents) {
      var self  = this;
      var state = this.state;

      // 支付报名费
      if (contestDef.registrationFee > 0) {
        BudgetManager.spend(
          contestDef.registrationFee,
          contestDef.name + ' 报名费',
          state.week
        );
      }

      // 构建比赛配置
      var config = RealContestEngine.buildContestConfig(contestDef, state.week);

      // 创建模拟器实例
      var simulator = new RealContestEngine.RealContestSimulator(
        config, selectedStudents, state
      );

      // 标记比赛为已完成
      state.completedCompetitions.add(contestDef.id + '_' + state.week);

      // 正式赛消耗本周行动机会
      state.actionTakenThisWeek = true;

      // 比赛结束回调
      simulator.onFinish = function (studentStates, contestConfig, log) {
        // 计算比赛结果
        var results = RealContestEngine.processContestResults(
          studentStates, contestConfig, contestDef, state
        );

        // 应用比赛效果（压力、心态、声望等）
        var effects = RealContestEngine.applyContestEffects(results.results, contestDef, results.passLine, state);

        // 更新晋级链
        self._updateQualifications(results, contestDef);

        // 记录比赛历史
        state.careerCompetitions.push({
          week:     state.week,
          name:     contestDef.name,
          season:   contestDef.season || 0,
          results:  results.results,
          passLine: results.passLine,
        });

        // 添加事件日志（包含奖牌和奖金信息）
        var passCount = 0;
        var goldCount = 0, silverCount = 0, bronzeCount = 0;
        for (var i = 0; i < results.results.length; i++) {
          if (results.results[i].passed) passCount++;
          if (results.results[i].medal === 'gold') goldCount++;
          else if (results.results[i].medal === 'silver') silverCount++;
          else if (results.results[i].medal === 'bronze') bronzeCount++;
        }
        var medalText = '';
        if (goldCount > 0) medalText += ' 🥇×' + goldCount;
        if (silverCount > 0) medalText += ' 🥈×' + silverCount;
        if (bronzeCount > 0) medalText += ' 🥉×' + bronzeCount;
        var prizeText = '';
        if (effects && effects.totalPrize && effects.totalPrize > 0) {
          prizeText += ' | 奖金 ¥' + effects.totalPrize.toLocaleString();
        }
        state.recentEvents.push({
          week:   state.week,
          message: contestDef.name + ' 结束！'
            + passCount + '/' + results.results.length + ' 人过线'
            + (medalText ? ' | ' + medalText.trim() : '')
            + '（分数线: ' + results.passLine + '/' + results.totalMax + '）'
            + prizeText,
          type: 'contest',
        });

        // 自动存档
        RealSaveManager.autoSave(self._serializeState());

        // 通知 UI 显示结果
        if (window.RealRender && RealRender.showContestResults) {
          RealRender.showContestResults(results, contestDef);
        }

        // 如果是最终比赛（第二个IOI），比赛结束后触发结算
        if (contestDef.isFinalContest) {
          state.gameOver = true;
          state.gameOverReason = '第二个IOI已结束，游戏结算';
          setTimeout(function () {
            RealGame._saveEndingData();
            window.location.href = 'real-end.html';
          }, 2000);
        }
      };

      return simulator;
    },

    // ==================== 举行模拟赛 ====================

    /**
     * 举行模拟赛（无报名费、不影响晋级链）
     * @param {Array}  selectedStudents      参赛学生列表
     * @param {Object|number} contestTypeOrDiff  ONLINE_CONTEST_TYPES 条目（含 difficulty/numProblems/displayName）或数字倍率（向后兼容）
     * @returns {Object} RealContestSimulator 实例
     */
    holdMockContest: function (selectedStudents, contestTypeOrDiff) {
      var state = this.state;

      // 模拟赛消耗本周行动机会（与正式赛一致）
      state.actionTakenThisWeek = true;

      // 解析 contestType：支持对象（ONLINE_CONTEST_TYPES 条目）或数字（向后兼容）
      var typeName      = '模拟赛';
      var numProblems   = 4;
      var baseDifficulty = 120;
      var useLegacy      = false;
      var diffMult       = 1.0;

      if (typeof contestTypeOrDiff === 'object' && contestTypeOrDiff !== null) {
        typeName       = contestTypeOrDiff.displayName || contestTypeOrDiff.name || '模拟赛';
        numProblems    = contestTypeOrDiff.numProblems || 4;
        baseDifficulty = contestTypeOrDiff.difficulty || 120;
      } else {
        // 向后兼容：传入数字作为难度倍率
        useLegacy = true;
        diffMult  = contestTypeOrDiff || 1.0;
      }

      // 模拟赛配置：IOI 格式（无罚分）
      var scorePer = 100;
      var mockConfig = {
        name:         typeName,
        format:       'IOI',
        formatDef:    CONTEST_FORMATS.IOI,
        problems:     [],
        totalMaxScore: numProblems * scorePer,
        duration:     Math.max(120, numProblems * 60), // 每题至少 1 小时，最少 2 小时
        tickInterval: 10,
      };

      // 标记为模拟赛（供 finish() 区分 contestType）
      mockConfig.contestDef = { id: 'mock', name: typeName, format: 'IOI' };

      // 生成题目
      if (useLegacy) {
        // 旧逻辑：4 道固定难度 × 倍率
        var diffs = [40, 60, 80, 110];
        for (var i = 0; i < 4; i++) {
          var diff = Math.floor(diffs[i] * diffMult);
          var randomTags = (RealContestEngine._randomTags) ? RealContestEngine._randomTags(diff) : [];
          var demands = RealContestEngine._generateDemands(diff, { type: randomTags[0] || 'DP', secondary: randomTags[1] || null });
          var prob = {
            id: i,
            difficulty:    diff,
            maxScore:      scorePer,
            demands:       demands,
            tags:          randomTags,
            thinkingBase:  demands.thinking,
            codingBase:    demands.coding,
          };
          mockConfig.problems.push(prob);
        }
      } else {
        // 新逻辑：根据 ONLINE_CONTEST_TYPES 的 difficulty 和 numProblems 生成题目
        // 难度分布：从 0.4× 到 1.4× 基础难度线性递增
        for (var i = 0; i < numProblems; i++) {
          var ratio;
          if (numProblems === 1) {
            ratio = 1.0;
          } else {
            ratio = 0.4 + (i / (numProblems - 1)) * 1.0; // 0.4 → 1.4
          }
          var diff = Math.max(20, Math.floor(baseDifficulty * ratio));
          var randomTags = (RealContestEngine._randomTags) ? RealContestEngine._randomTags(diff) : [];
          var demands = RealContestEngine._generateDemands(diff, { type: randomTags[0] || 'DP', secondary: randomTags[1] || null });
          var prob = {
            id: i,
            difficulty:    diff,
            maxScore:      scorePer,
            demands:       demands,
            tags:          randomTags,
            thinkingBase:  demands.thinking,
            codingBase:    demands.coding,
          };
          mockConfig.problems.push(prob);
        }
      }

      var simulator = new RealContestEngine.RealContestSimulator(
        mockConfig, selectedStudents, state
      );

      // 模拟赛结束回调（finish() 已处理挂分和逐题性格修正）
      simulator.onFinish = function (studentStates, contestConfig, log) {
        // finish() 已通过 applyScoreModifier 逐题修正并计算 finalScore
        // 此处仅需增加模拟赛计数
        for (var name in studentStates) {
          if (!studentStates.hasOwnProperty(name)) continue;
          var ss = studentStates[name];
          ss.student.mockContestCount = (ss.student.mockContestCount || 0) + 1;
        }

        // 通知 UI 显示结果
        if (window.RealRender && RealRender.showContestResults) {
          var mockResults = {
            results:  [],
            passLine: 0,
            totalMax: mockConfig.totalMaxScore,
            contestDef: { name: mockConfig.name, format: 'IOI', id: 'mock' },
          };
          for (var name2 in studentStates) {
            if (!studentStates.hasOwnProperty(name2)) continue;
            var ss2 = studentStates[name2];
            mockResults.results.push({
              student:  ss2.student,
              score:    ss2.finalScore || ss2.totalScore || 0,
              rawScore: ss2.totalScore || 0,
              maxScore: mockConfig.totalMaxScore,
              passed:   true,       // 模拟赛没有过/不过
              problems: ss2.problems,
            });
          }
          RealRender.showContestResults(mockResults, { name: mockConfig.name, format: 'IOI' });
        }
      };

      return simulator;
    },

    // ==================== 对点招生 ====================

    /**
     * 招收新学生（花费 ¥5,000）
     * @returns {Object} {success, message, student?}
     */
    recruitStudent: function () {
      var state = this.state;

      // 仅在赛季1（Year 1，week 1-48）允许招生
      var season = RealCalendar.getSeason(state.week);
      if (season === 2) {
        return { success: false, message: '链2开始后无法进行对点招生' };
      }

      // 上限检查
      if (state.students.length >= 15) {
        return { success: false, message: '学生人数已满（最多15人）' };
      }
      // 经费检查
      if (BudgetManager.getFunds() < 5000) {
        return { success: false, message: '经费不足（需要 ¥5,000）' };
      }

      // 扣费
      BudgetManager.spend(5000, '对点招生', state.week);

      // 创建学生
      var existingNames = state.students.map(function (s) { return s.name; });
      var name    = _makeUniqueName(state.provinceName, existingNames);
      var dm      = _diffMod(state.difficulty);
      var thinking = _randomAbility(30, 50, dm);
      var coding   = _randomAbility(25, 45, dm);
      var mental   = _randomAbility(20, 40, dm);

      var student = new Student(name, thinking, coding, mental);
      PersonalityManager.assignPersonalities(student);
      if (TalentManager && TalentManager.assignInitialTalent) {
        TalentManager.assignInitialTalent(student);
      }

      state.students.push(student);

      return { success: true, message: '成功招收了 ' + name, student: student };
    },

    // ==================== 辞退学生 ====================

    /**
     * 辞退指定学生
     * @param {string} studentName 学生姓名
     * @returns {boolean} 是否成功
     */
    dismissStudent: function (studentName) {
      var state = this.state;
      var idx   = -1;
      for (var i = 0; i < state.students.length; i++) {
        if (state.students[i].name === studentName) {
          idx = i;
          break;
        }
      }
      if (idx === -1) return false;

      state.students.splice(idx, 1);
      state.quit_students++;
      return true;
    },

    // ==================== 请学生吃饭 ====================

    /**
     * 请学生吃饭（花费 ¥800，不消耗时间/周数）
     * 降低所有活跃学生压力 8~12，恢复体力 16~24
     * @returns {Object} {success, message, effects?}
     */
    treatStudents: function () {
      var state = this.state;

      // 经费检查
      if (BudgetManager.getFunds() < 800) {
        return { success: false, message: '经费不足（需要 ¥800）' };
      }

      // 扣费
      BudgetManager.spend(800, '请学生吃饭', state.week);

      // 对所有活跃学生施加效果
      var effects = [];
      var activeCount = 0;
      for (var i = 0; i < state.students.length; i++) {
        var s = state.students[i];
        if (s.active === false) continue;
        activeCount++;

        var pressureDrop = Math.floor(8 + Math.random() * 5);  // 8~12 (~10)
        var staminaGain = Math.floor(16 + Math.random() * 9);   // 16~24 (~20)

        s.pressure = Math.max(0, Math.min(100, s.pressure - pressureDrop));
        s.stamina = Math.min(s.maxStamina || 75, s.stamina + staminaGain);

        // --- 天赋触发：吃饭减压事件（劳逸结合等） ---
        if (typeof s.triggerTalents === 'function') {
          s.triggerTalents('treat_finished', { pressureRelief: pressureDrop });
        }

        effects.push({
          name: s.name,
          pressureDrop: pressureDrop,
          staminaGain: staminaGain
        });
      }

      if (activeCount === 0) {
        return { success: false, message: '没有活跃的学生' };
      }

      var message = '请 ' + activeCount + ' 名学生吃了饭，大家心情好了不少';
      return { success: true, message: message, effects: effects };
    },

    // ==================== 设施升级 ====================

    /**
     * 升级指定设施
     * @param {string} facKey - 设施键名（computer/ac/dorm/library/canteen）
     * @returns {Object} {success, message}
     */
    upgradeFacility: function (facKey) {
      var state = this.state;
      var f = state.facilities;
      if (!f) return { success: false, message: '设施系统未初始化' };

      // 设施名称映射
      var nameMap = {
        computer: '电脑', library: '图书馆', ac: '空调',
        dorm: '宿舍', canteen: '食堂'
      };
      var facName = nameMap[facKey] || facKey;

      // 检查等级上限
      var maxLevel = f.getMaxLevel(facKey);
      var currentLevel = f.getCurrentLevel(facKey);
      if (currentLevel >= maxLevel) {
        return { success: false, message: facName + ' 已达最高等级（Lv.' + maxLevel + '）！' };
      }

      // 获取升级费用（使用 Facilities 类自带的 getUpgradeCost）
      var cost = f.getUpgradeCost(facKey);
      if (BudgetManager.getFunds() < cost) {
        return { success: false, message: '经费不足！升级需要 ¥' + cost.toLocaleString() };
      }

      // 扣费并升级
      BudgetManager.spend(cost, '升级' + facName, state.week);
      f.upgrade(facKey);

      var newLevel = f.getCurrentLevel(facKey);
      return {
        success: true,
        message: facName + ' 升级到 Lv.' + newLevel + '！'
      };
    },

    // ==================== 内部方法 ====================

    /**
     * 更新晋级链：将过线学生加入对应比赛的资格集合
     */
    _updateQualifications: function (results, contestDef) {
      var state = this.state;
      var qualSet = state.qualification[contestDef.id];
      if (!qualSet) return;

      for (var i = 0; i < results.results.length; i++) {
        var r = results.results[i];
        if (r.passed) {
          qualSet.add(r.student.name);
          r.student.formalContestCount = (r.student.formalContestCount || 0) + 1;
        }
      }
    },

    /**
     * 处理每周事件列表，写入 recentEvents
     */
    _processEvents: function (events) {
      var state = this.state;
      if (!events) return;

      for (var i = 0; i < events.length; i++) {
        var evt = events[i];
        var messages = evt.messages || [];
        for (var j = 0; j < messages.length; j++) {
          state.recentEvents.push({
            week:   state.week,
            message: messages[j],
            type:   evt.type || 'event',
          });
        }
      }
    },

    /**
     * 处理训练行动产生的子事件，格式化为日志
     */
    _processActionEvents: function (actionEvents) {
      var state = this.state;
      if (!actionEvents) return;

      for (var i = 0; i < actionEvents.length; i++) {
        var evt = actionEvents[i];

        // 纯 message 事件（mismatch 警告、天赋等，无 student 字段）
        if (evt.message && !evt.student) {
          state.recentEvents.push({
            week:   state.week,
            message: evt.message,
            type:   evt.type || 'warning',
          });
          continue;
        }

        // 有 student 但也有 message 且无 knowledge 的事件（如省钱大师费用减免）
        if (evt.message && evt.student && !evt.knowledge && !evt.thinkingGain) {
          state.recentEvents.push({
            week:   state.week,
            message: evt.message,
            type:   evt.type || 'info',
          });
          continue;
        }

        var msg = '';

        // 学生名
        if (evt.student) {
          msg = evt.student + ': ';
        }

        // 知识点增长
        if (evt.knowledge) {
          var parts = [];
          for (var key in evt.knowledge) {
            if (evt.knowledge.hasOwnProperty(key)) {
              parts.push(key + '+' + evt.knowledge[key]);
            }
          }
          if (parts.length > 0) {
            msg += parts.join(', ');
          }
        }

        // 能力增长
        if (evt.thinkingGain) msg += ', 思维+' + Math.round(evt.thinkingGain * 10) / 10;
        if (evt.codingGain)   msg += ', 编码+' + Math.round(evt.codingGain * 10) / 10;

        // 压力变化
        if (evt.pressureChange) {
          var pc = Math.round(evt.pressureChange * 10) / 10;
          msg += ', 压力' + (pc > 0 ? '+' : '') + pc;
        }

        // 体力消耗
        if (evt.staminaCost) {
          msg += ', 体力-' + Math.round(evt.staminaCost);
        }

        state.recentEvents.push({
          week:   state.week,
          message: msg,
          type:   evt.type || 'training',
        });
      }
    },

    /**
     * 根据当前月份更新天气和温度
     */
    _updateWeather: function () {
      var state  = this.state;
      var month  = RealCalendar.getMonth(state.week);
      if (!month) return;

      var monthName = month.month;
      var isNorth  = state.is_north;

      if (monthName === '一月' || monthName === '二月') {
        state.weather     = isNorth ? '雪' : '阴';
        state.temperature = isNorth
          ? -5 + Math.floor(Math.random() * 10)
          :  5 + Math.floor(Math.random() * 10);
      } else if (monthName === '七月' || monthName === '八月') {
        state.weather     = (Math.random() < 0.3) ? '雨' : '晴';
        state.temperature = isNorth
          ? 28 + Math.floor(Math.random() * 8)
          : 33 + Math.floor(Math.random() * 8);
      } else if (monthName === '九月' || monthName === '十月') {
        state.weather     = '晴';
        state.temperature = isNorth
          ? 15 + Math.floor(Math.random() * 10)
          : 22 + Math.floor(Math.random() * 8);
      } else if (monthName === '十一月' || monthName === '十二月') {
        state.weather     = isNorth ? '晴' : '阴';
        state.temperature = isNorth
          ? -2 + Math.floor(Math.random() * 12)
          :  8 + Math.floor(Math.random() * 10);
      } else {
        // 春季 / 初夏
        state.weather     = (Math.random() < 0.2) ? '雨' : '晴';
        state.temperature = isNorth
          ? 18 + Math.floor(Math.random() * 12)
          : 22 + Math.floor(Math.random() * 10);
      }
    },

    /**
     * 检查游戏结束条件
     * @returns {boolean} 是否结束
     */
    _checkEnding: function () {
      var state = this.state;

      // 经费耗尽（第 10 周之后才判定）
      if (BudgetManager.getFunds() <= 0 && state.week > 10) {
        state.gameOver       = true;
        state.gameOverReason = '经费不足';
        return true;
      }

      // 检查倦怠退赛（先处理，再检查无学生）
      for (var j = 0; j < state.students.length; j++) {
        var s = state.students[j];
        if (s.active === false) continue;
        if (s.burnout_weeks >= 6) {
          // 自虐狂性格免疫倦怠退赛
          if (PersonalityManager.hasHiddenPersonality &&
              PersonalityManager.hasHiddenPersonality(s, '自虐狂')) {
            continue;
          }
          s.active = false;
          state.quit_students++;
          state.recentEvents.push({
            week:   state.week,
            message: s.name + ' 因压力过大而退赛了！',
            type:   'critical',
          });
        }
      }

      // 无活跃学生（在 burnout 处理之后检查）
      var activeCount = 0;
      for (var i = 0; i < state.students.length; i++) {
        if (state.students[i].active !== false) activeCount++;
      }
      if (activeCount === 0) {
        state.gameOver       = true;
        state.gameOverReason = '无学生';
        return true;
      }

      // 超出赛季周数或第二个IOI已结束
      var maxWeek = (typeof window.SECOND_IOI_WEEK === 'number') ? window.SECOND_IOI_WEEK : (window.SEASON_WEEKS || SEASON_WEEKS);
      if (state.week > maxWeek) {
        state.gameOver       = true;
        state.gameOverReason = '第二个IOI已结束，游戏结束';
        return true;
      }

      // 晋级链断裂检测（仅 week > 48 时检查链2）
      // 判断逻辑：每个活跃学生是否在链2中还有可以参加的未来比赛（含本周）
      if (state.week > 48 && typeof window.REAL_CONTEST_SCHEDULE !== 'undefined') {
        var allChainBroken = true;
        for (var si = 0; si < state.students.length; si++) {
          var st = state.students[si];
          if (st.active === false) continue;

          var hasFuture = false;
          for (var ci = 0; ci < window.REAL_CONTEST_SCHEDULE.length; ci++) {
            var contest = window.REAL_CONTEST_SCHEDULE[ci];
            // 只看链2的比赛
            if (contest.season !== 2) continue;
            // 跳过已过去的比赛（不含本周，本周比赛可以参加）
            if (contest.week < state.week) continue;
            // required 比赛无前置条件，可直接参加
            if (contest.required) {
              hasFuture = true;
              break;
            }
            // 可选比赛：检查前置条件
            var qualId = contest.qualificationFrom;
            if (!qualId) {
              hasFuture = true;
              break;
            }
            var qualSet = state.qualification[qualId];
            if (qualSet && qualSet.has(st.name)) {
              hasFuture = true;
              break;
            }
          }
          if (hasFuture) {
            allChainBroken = false;
            break;
          }
        }
        if (allChainBroken) {
          state.gameOver       = true;
          state.gameOverReason = '链2所有选手晋级链断裂';
          state.recentEvents.push({
            week:   state.week,
            message: '所有活跃选手的链2晋级链均已断裂，游戏结束！',
            type:   'critical',
          });
          return true;
        }
      }

      return false;
    },

    // ==================== 保存结算数据 ====================

    /**
     * 将结算数据保存到 localStorage，供 real-end.html 读取
     */
    _saveEndingData: function () {
      var state = this.state;
      if (!state) return;

      // 序列化学生（只保留需要的字段）
      var studentsData = [];
      for (var i = 0; i < state.students.length; i++) {
        var s = state.students[i];
        studentsData.push({
          name: s.name,
          active: s.active,
          thinking: Math.floor(s.thinking || 0),
          coding: Math.floor(s.coding || 0),
          mental: Math.floor(s.mental || 0),
          knowledge_ds: Math.floor(s.knowledge_ds || 0),
          knowledge_graph: Math.floor(s.knowledge_graph || 0),
          knowledge_string: Math.floor(s.knowledge_string || 0),
          knowledge_math: Math.floor(s.knowledge_math || 0),
          knowledge_dp: Math.floor(s.knowledge_dp || 0),
          personality: s.personality,
          gender: s.gender
        });
      }

      // 序列化比赛结果（保留核心数据）
      var compsData = [];
      var comps = state.careerCompetitions || [];
      for (var i = 0; i < comps.length; i++) {
        var c = comps[i];
        var resultsData = [];
        if (c.results) {
          for (var r = 0; r < c.results.length; r++) {
            resultsData.push({
              student: c.results[r].student ? { name: c.results[r].student.name } : null,
              score: c.results[r].score || 0,
              passed: c.results[r].passed,
              medal: c.results[r].medal
            });
          }
        }
        compsData.push({
          name: c.name,
          week: c.week,
          season: c.season,
          results: resultsData
        });
      }

      var endingData = {
        reason: state.gameOverReason || '赛季结束',
        difficulty: state.difficulty,
        provinceName: state.provinceName,
        provinceType: state.provinceType,
        week: state.week,
        reputation: state.reputation || 0,
        initialStudents: state.initial_students || 0,
        quitStudents: state.quit_students || 0,
        medals: state.totalMedals || { gold: 0, silver: 0, bronze: 0 },
        students: studentsData,
        competitions: compsData
      };

      try {
        localStorage.setItem('oi_real_ending', JSON.stringify(endingData));
      } catch (e) {
        console.error('保存结算数据失败:', e);
      }
    },

    // ==================== 状态序列化（存档） ====================

    /**
     * 将完整游戏状态序列化为可 JSON 序列化的对象
     * @returns {Object} 序列化后的状态数据
     */
    _serializeState: function () {
      var state = this.state;

      // ---------- 序列化学生 ----------
      var studentsData = [];
      for (var i = 0; i < state.students.length; i++) {
        var s = state.students[i];
        studentsData.push({
          name:              s.name,
          _base_thinking:    s._base_thinking,
          _base_coding:      s._base_coding,
          _base_mental:      s._base_mental,
          talents:           Array.from(s.talents),
          knowledge_ds:      s.knowledge_ds,
          knowledge_graph:   s.knowledge_graph,
          knowledge_string:  s.knowledge_string,
          knowledge_math:    s.knowledge_math,
          knowledge_dp:      s.knowledge_dp,
          pressure:          s.pressure,
          comfort:           s.comfort,
          active:            s.active,
          burnout_weeks:     s.burnout_weeks || 0,
          sick_weeks:        s.sick_weeks || 0,
          // Real Mode 属性
          personality:        s.personality,
          hiddenPersonalities: s.hiddenPersonalities || [],
          gender:             s.gender,
          physique:           s.physique,
          stamina:            s.stamina,
          maxStamina:         s.maxStamina,
          academicScore:      s.academicScore,
          mockContestCount:   s.mockContestCount || 0,
          formalContestCount: s.formalContestCount || 0,
          depression_count:   s.depression_count || 0,
          high_pressure_weeks: s.high_pressure_weeks || 0,
        });
      }

      // ---------- 序列化晋级链（Set → Array）----------
      var qualData = {};
      for (var key in state.qualification) {
        if (state.qualification.hasOwnProperty(key)) {
          qualData[key] = Array.from(state.qualification[key]);
        }
      }

      // ---------- 序列化设施 ----------
      var facData = {
        computer: state.facilities.computer,
        ac:       state.facilities.ac,
        dorm:     state.facilities.dorm,
        library:  state.facilities.library,
        canteen:  state.facilities.canteen,
      };

      // ---------- 组装完整数据 ----------
      var data = {
        // 基本信息
        week:               state.week,
        difficulty:         state.difficulty,
        provinceIndex:      state.provinceIndex,
        provinceName:       state.provinceName,
        provinceType:       state.provinceType,
        is_north:           state.is_north,
        reputation:         state.reputation,
        initial_students:   state.initial_students,
        quit_students:      state.quit_students,
        gameOver:           state.gameOver,
        gameOverReason:     state.gameOverReason,
        actionTakenThisWeek: state.actionTakenThisWeek,
        weather:            state.weather,
        temperature:        state.temperature,
        totalMedals:        state.totalMedals,
        totalPasses:        state.totalPasses,

        // 学生
        students: studentsData,

        // 设施
        facilities: facData,

        // 晋级链
        qualification: qualData,

        // 集合 / 列表
        completedCompetitions: Array.from(state.completedCompetitions),
        careerCompetitions:    state.careerCompetitions,
        eventLog:             state.eventLog.slice(-50),   // 只保留最近 50 条
        recentEvents:         state.recentEvents.slice(-20),
        weeklyTasks:          state.weeklyTasks,

        // 预算
        budget: BudgetManager.serialize(),
      };

      return data;
    },

    /**
     * 从序列化数据恢复游戏状态
     * @param {Object} data 序列化后的状态数据
     */
    _deserializeState: function (data) {
      var state = this.state;

      // ---------- 恢复简单字段 ----------
      state.week                = data.week;
      state.difficulty          = data.difficulty;
      state.provinceIndex       = data.provinceIndex;
      state.provinceName        = data.provinceName;
      state.provinceType        = data.provinceType;
      state.is_north            = data.is_north;
      state.reputation          = data.reputation;
      state.initial_students    = data.initial_students;
      state.quit_students       = data.quit_students;
      state.gameOver            = data.gameOver;
      state.gameOverReason      = data.gameOverReason;
      state.actionTakenThisWeek = data.actionTakenThisWeek;
      state.weather             = data.weather;
      state.temperature         = data.temperature;
      state.totalMedals         = data.totalMedals || { gold: 0, silver: 0, bronze: 0 };
      state.totalPasses         = data.totalPasses || 0;

      // ---------- 恢复学生 ----------
      state.students = [];
      for (var i = 0; i < data.students.length; i++) {
        var sd = data.students[i];
        var s  = new Student(sd.name, sd._base_thinking, sd._base_coding, sd._base_mental);

        // 天赋
        var talentList = sd.talents || [];
        for (var ti = 0; ti < talentList.length; ti++) {
          s.talents.add(talentList[ti]);
        }

        // 知识点
        s.knowledge_ds     = sd.knowledge_ds;
        s.knowledge_graph  = sd.knowledge_graph;
        s.knowledge_string = sd.knowledge_string;
        s.knowledge_math   = sd.knowledge_math;
        s.knowledge_dp     = sd.knowledge_dp;

        // 状态
        s.pressure       = sd.pressure;
        s.comfort        = sd.comfort || 50;
        s.active         = sd.active !== false;
        s.burnout_weeks  = sd.burnout_weeks || 0;
        s.sick_weeks     = sd.sick_weeks || 0;

        // Real Mode 属性
        s.personality          = sd.personality;
        s.hiddenPersonalities  = sd.hiddenPersonalities || [];
        s.gender               = sd.gender;
        s.physique             = sd.physique;
        s.stamina              = sd.stamina;
        s.maxStamina           = sd.maxStamina;
        s.academicScore        = sd.academicScore;
        s.mockContestCount     = sd.mockContestCount || 0;
        s.formalContestCount   = sd.formalContestCount || 0;
        s.depression_count     = sd.depression_count || 0;
        s.high_pressure_weeks  = sd.high_pressure_weeks || 0;

        state.students.push(s);
      }

      // ---------- 恢复设施 ----------
      if (data.facilities) {
        state.facilities.computer = data.facilities.computer;
        state.facilities.ac       = data.facilities.ac;
        state.facilities.dorm     = data.facilities.dorm;
        state.facilities.library  = data.facilities.library;
        state.facilities.canteen  = data.facilities.canteen;
      }

      // ---------- 恢复晋级链（Array → Set）----------
      state.qualification = {};
      for (var key in data.qualification) {
        if (data.qualification.hasOwnProperty(key)) {
          state.qualification[key] = new Set(data.qualification[key]);
        }
      }

      // ---------- 恢复集合 / 列表 ----------
      state.completedCompetitions = new Set(data.completedCompetitions || []);
      state.careerCompetitions    = data.careerCompetitions || [];
      state.eventLog              = data.eventLog || [];
      state.recentEvents          = data.recentEvents || [];
      state.weeklyTasks           = data.weeklyTasks || [];

      // ---------- 恢复预算 ----------
      if (data.budget) {
        BudgetManager.deserialize(data.budget);
      }
    },

    // ==================== 加载存档 ====================

    /**
     * 从指定存档槽位加载游戏
     * @param {number} slotIndex 存档槽位索引
     * @returns {boolean} 是否成功加载
     */
    loadGame: function (slotIndex) {
      var data = RealSaveManager.load(slotIndex);
      if (!data) return false;

      // 重置状态容器
      this.state = {
        facilities:             new Facilities(),
        qualification:          {},
        completedCompetitions:  new Set(),
      };

      // 填充数据
      this._deserializeState(data);

      // 重新初始化事件管理器
      RealEventManager.init();

      return true;
    },

    // ==================== 查询：学生参赛资格 ====================

    /**
     * 检查学生是否有资格参加指定比赛
     * @param {Object} student  Student 实例
     * @param {string} contestId 比赛标识
     * @returns {Object} {eligible: boolean, reason: string}
     */
    getStudentQualification: function (student, contestId) {
      // 查找比赛定义
      var contestDef = null;
      for (var i = 0; i < REAL_CONTEST_SCHEDULE.length; i++) {
        if (REAL_CONTEST_SCHEDULE[i].id === contestId) {
          contestDef = REAL_CONTEST_SCHEDULE[i];
          break;
        }
      }
      if (!contestDef) {
        return { eligible: false, reason: '未知比赛' };
      }

      // 检查前置比赛资格
      if (contestDef.qualificationFrom) {
        var prevQual = this.state.qualification[contestDef.qualificationFrom];
        if (!prevQual || !prevQual.has(student.name)) {
          return {
            eligible: false,
            reason: '未通过前置比赛 ' + contestDef.qualificationFrom,
          };
        }
      }

      return { eligible: true, reason: '' };
    },

    // ==================== 查询：下一场比赛 ====================

    /**
     * 获取下一场即将到来的比赛
     * @returns {Object|null} {contest, weeksAway, weekStr} 或 null
     */
    getNextContest: function () {
      var state = this.state;
      for (var i = 0; i < REAL_CONTEST_SCHEDULE.length; i++) {
        var c = REAL_CONTEST_SCHEDULE[i];
        if (c.week > state.week) {
          return {
            contest:   c,
            weeksAway: c.week - state.week,
            weekStr:   RealCalendar.formatWeek(c.week),
          };
        }
      }
      return null;
    },

    // ==================== 查询：晋级链进度 ====================

    /**
     * 获取指定学生的完整晋级链状态
     * @param {Object} student Student 实例
     * @returns {Array} [{id, name, week, qualified}]
     */
    getQualificationChain: function (student) {
      var chain = [];
      for (var i = 0; i < REAL_CONTEST_SCHEDULE.length; i++) {
        var c = REAL_CONTEST_SCHEDULE[i];
        var qualSet = this.state.qualification[c.id];
        var qualified = qualSet ? qualSet.has(student.name) : false;

        chain.push({
          id:        c.id,
          name:      c.name,
          week:      c.week,
          qualified: qualified,
        });
      }
      return chain;
    },

    // ==================== 查询：当前学期信息 ====================

    /**
     * 获取当前学期相关描述
     * @returns {Object} {term, month, isVacation}
     */
    getCurrentTermInfo: function () {
      var state = this.state;
      return {
        term:       RealCalendar.getTerm(state.week),
        month:      RealCalendar.getMonth(state.week),
        isVacation: RealCalendar.isVacation(state.week),
      };
    },

    // ==================== 查询：活跃学生 ====================

    /**
     * 获取当前活跃学生列表（排除已退赛 / 已禁用）
     * @returns {Array} Student 实例数组
     */
    getActiveStudents: function () {
      var result = [];
      for (var i = 0; i < this.state.students.length; i++) {
        var s = this.state.students[i];
        if (s.active !== false) {
          result.push(s);
        }
      }
      return result;
    },

    // ==================== 查询：本周概况 ====================

    /**
     * 获取本周概况摘要（供 UI 展示）
     * @returns {Object} 本周关键信息
     */
    getWeekSummary: function () {
      var state = this.state;

      var nextContest = this.getNextContest();
      var activeStudents = this.getActiveStudents();
      var contestsThisWeek = RealCalendar.getContestsAtWeek(state.week);

      return {
        week:                state.week,
        weekStr:             RealCalendar.formatWeek(state.week),
        term:                RealCalendar.getTerm(state.week),
        month:               RealCalendar.getMonth(state.week),
        isVacation:          RealCalendar.isVacation(state.week),
        weather:             state.weather,
        temperature:         state.temperature,
        reputation:          state.reputation,
        funds:               BudgetManager.getFunds(),
        activeStudentCount:  activeStudents.length,
        totalStudentCount:   state.students.length,
        actionTaken:         state.actionTakenThisWeek,
        contestsThisWeek:    contestsThisWeek || [],
        nextContest:         nextContest,
        recentEvents:        state.recentEvents.slice(-10),
        weeklyTasks:         state.weeklyTasks,
      };
    },

  }; // end window.RealGame

})();
