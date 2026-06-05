/* ==========================================================================
 * real-simulator.js — OItrainer「Real Mode」比赛模拟引擎
 * --------------------------------------------------------------------------
 * 扩展原始 CompetitionEngine.ContestSimulator，支持 Real Mode 的多种
 * 比赛赛制（OI / IOI / SELF_EVAL / ACM）以及挂分机制、本地评测等特性。
 *
 * 核心差异（与原始 ContestSimulator 对比）：
 *   1. 支持 OI 赛制的「挂分」机制（scoreLoss）
 *   2. 支持 SELF_EVAL 赛制的本地评测轮次（localTestRounds）
 *   3. 支持 IOI 赛制的实时反馈（无挂分、有实时策略调整）
 *   4. 比赛后应用性格修正器（PersonalityManager.applyScoreModifier）
 *   5. 比赛后处理晋级线、声望、压力、生涯记录等
 *
 * 风格约定：
 *   - ES5 语法（var / function，不使用 let/const/箭头函数/模板字符串/解构）
 *   - 所有全局挂载使用 window.* 前缀
 *   - 注释使用中文
 *
 * 依赖：
 *   - window.CompetitionEngine.ContestSimulator（原始模拟器）
 *   - window.CONTEST_FORMATS（real-data.js）
 *   - window.REAL_CONTEST_SCHEDULE（real-data.js）
 *   - window.PersonalityManager（real-personality.js）
 *   - window.getRandom / uniform / uniformInt / normal / sigmoid（utils.js）
 *   - window.Student（models.js）
 * ========================================================================== */

(function (global) {

  /* ========================================================================
   * 第 1 节：全局命名空间
   * ======================================================================== */

  var RealContestEngine = {};

  /* ========================================================================
   * 第 2 节：内部常量
   * ======================================================================== */

  // 每个 tick 代表的比赛时间（分钟），与原始 ContestSimulator 一致
  var TICK_INTERVAL = 10;

  // Subtask 数量范围（与原始 generateSubtasks 的 3~5 档一致）
  var MIN_SUBTASKS = 3;
  var MAX_SUBTASKS = 5;

  // 默认 subtask 难度指数曲线参数（与原始引擎保持一致）
  var SUBTASK_MIN_DIFF_RATIO = 0.35;
  var SUBTASK_DIFF_EXPONENT = 1.8;

  // 知识点门槛系数：知识点需求 = 题目难度 × 此值（与原始一致）
  var KNOWLEDGE_REQUIREMENT_RATIO = 0.35;
  // 知识点需求最低值
  var KNOWLEDGE_REQUIREMENT_FLOOR = 15;
  // 知识点惩罚衰减系数（差距每增加此值，概率降低 e^-1 ≈ 37%）
  var KNOWLEDGE_PENALTY_SCALE = 15.0;
  // 知识点惩罚最低保留概率
  var KNOWLEDGE_PENALTY_FLOOR = 0.05;

  // 思维 / 代码检定的 sigmoid 灵敏度参数
  var SIGMOID_SENSITIVITY = 12.0;

  // 思维稳定性范围（mental / 100 → 映射到此区间）
  var THINKING_STABILITY_MIN = 0.75;
  var THINKING_STABILITY_RANGE = 0.25;

  // 代码稳定性范围（mental / 100 → 映射到较窄区间）
  var CODING_STABILITY_MIN = 0.80;
  var CODING_STABILITY_RANGE = 0.20;

  // 思维能力的知识加成系数
  var THINKING_KNOWLEDGE_COEFF = 0.5;

  // 代码能力的知识加成系数
  var CODING_KNOWLEDGE_COEFF = 0.3;

  // 挂分机制上限（最大挂分概率）
  var SCORE_LOSS_BASE_RATE = 0.03;     // 基础挂分概率 3%
  var SCORE_LOSS_MAX_PROB = 0.05;      // 挂分概率封顶 5%
  var SCORE_LOSS_LOW_PROB = 0.005;     // coding 远高于需求时固定概率 0.5%
  var SCORE_LOSS_RATIO_MIN = 0.05;    // 挂分比例下限 5%
  var SCORE_LOSS_RATIO_MAX = 0.10;    // 挂分比例上限 10%
  var SCORE_LOSS_CODING_MARGIN = 50;   // coding 超出需求多少视为"远高于需求"

  // 本地评测每轮最多恢复的分数比例（相对于满分）
  var LOCAL_TEST_FIX_RATIO = 0.10;

  // 跳题时间阈值：如果在此时间内没有任何进展（分钟），可能跳题
  var SKIP_TIME_BASE = 30;
  // 跳题概率：超过阈值后每增加10分钟的额外概率
  var SKIP_PROB_PER_TEN_MIN = 0.15;
  // 最大跳题概率
  var SKIP_PROB_MAX = 0.80;

  // 选题时的位置加权：第 i 题获得 (POSITION_BONUS_BASE - i * POSITION_BONUS_STEP) 的额外权重
  var POSITION_BONUS_BASE = 40;
  var POSITION_BONUS_STEP = 8;

  // 晋级线浮动范围 ±5%
  var PASS_LINE_FLUCTUATION = 0.05;

  /* ========================================================================
   * 第 3 节：分数挂失计算器 — calculateScoreLoss
   * -----------------------------------------------------------------------
   * 仅当 format.hasScoreLoss === true（即 OI 赛制）时生效。
   * 考虑学生的心理、代码能力、压力以及性格修正（如追求完美者的 scoreLossResist）。
   * ======================================================================== */

  /**
   * 计算一道题的挂分值
   * 规则：
   *   - 仅 OI 赛制（hasScoreLoss === true）且实际得分 > 0 时生效
   *   - 基础概率 3%，封顶 5%
   *   - 心理修正: ×(1 - mental/150)
   *   - 编码修正: ×(1 - coding/250)
   *   - 压力修正: ×(1 + pressure/200)
   *   - coding 远高于需求（超出 50+）时固定 0.5% 概率
   *   - 追求完美者性格不会挂分
   *   - 挂分时丢失 5%~10% 的分数
   * @param {Object} student - 学生对象
   * @param {Object} problem - 题目状态对象 { actualScore, maxScore, demands }
   * @param {Object} format - 赛制定义（CONTEST_FORMATS 中的条目）
   * @returns {Object} { loss: number, reason: string } 或 { loss: 0 }
   */
  RealContestEngine.calculateScoreLoss = function (student, problem, format) {
    if (!format || !format.hasScoreLoss || !problem || problem.actualScore <= 0) {
      return { loss: 0 };
    }

    // 追求完美者性格不会挂分
    if (typeof PersonalityManager !== 'undefined') {
      if (typeof PersonalityManager.hasHiddenPersonality === 'function' &&
          PersonalityManager.hasHiddenPersonality(student, '\u8ffd\u6c42\u5b8c\u7f8e\u8005')) {
        return { loss: 0 };
      }
      if (typeof PersonalityManager.hasPersonality === 'function' &&
          PersonalityManager.hasPersonality(student, '\u8ffd\u6c42\u5b8c\u7f8e\u8005')) {
        return { loss: 0 };
      }
      // 备用检查：personality 属性
      if (student.personality === '\u8ffd\u6c42\u5b8c\u7f8e\u8005') {
        return { loss: 0 };
      }
    }

    // 基础挂分概率 3%
    var baseRate = SCORE_LOSS_BASE_RATE;

    // 心理修正: ×(1 - mental/150)，mental 越高挂分概率越低
    var mental = Number(student.mental || 50);
    var mentalFactor = 1 - mental / 150;

    // 编码修正: ×(1 - coding/250)，coding 越高挂分概率越低
    var coding = Number(student.coding || 50);
    var codingFactor = 1 - coding / 250;

    // 压力修正: ×(1 + pressure/200)，压力越高挂分概率越高
    var pressure = Number(student.pressure || 0);
    var pressureFactor = 1 + pressure / 200;

    // 检查 coding 是否远高于题目需求
    var demandCoding = 0;
    if (problem.demands && typeof problem.demands.coding === 'number') {
      demandCoding = problem.demands.coding;
    } else if (problem.demands && typeof problem.demands.tc === 'number') {
      demandCoding = problem.demands.tc;
    }
    var isCodingMuchHigher = demandCoding > 0 && (coding - demandCoding) >= SCORE_LOSS_CODING_MARGIN;

    var lossProb;
    if (isCodingMuchHigher) {
      // coding 远高于需求时固定 0.5% 概率
      lossProb = SCORE_LOSS_LOW_PROB;
    } else {
      // 综合概率 = 基础 × 心理 × 编码 × 压力
      lossProb = baseRate * mentalFactor * codingFactor * pressureFactor;
      // 封顶 5%
      lossProb = Math.max(0, Math.min(SCORE_LOSS_MAX_PROB, lossProb));
    }

    // 挂分原因
    var reasons = ['\u8fb9\u754c\u6761\u4ef6\u5904\u7406\u4e0d\u5f53', '\u6570\u7ec4\u8d8a\u754c', '\u5fd8\u8bb0\u7279\u5224', 'long long\u5199\u6210int',
      '\u6ea2\u51fa\u95ee\u9898', '\u5faa\u73af\u53d8\u91cf\u672a\u521d\u59cb\u5316', '\u5f00\u6570\u672a\u5f00\u5927\u8db3'];

    // 概率检定
    if (Math.random() < lossProb) {
      var lossRatio = SCORE_LOSS_RATIO_MIN + Math.random() * (SCORE_LOSS_RATIO_MAX - SCORE_LOSS_RATIO_MIN);
      var lossAmount = Math.max(1, Math.floor(problem.actualScore * lossRatio));
      var reason = reasons[Math.floor(Math.random() * reasons.length)];
      return { loss: lossAmount, reason: reason };
    }

    return { loss: 0 };
  };

  /* ========================================================================
   * 第 4 节：本地评测模拟 — simulateLocalTesting
   * -----------------------------------------------------------------------
   * 仅在 SELF_EVAL 赛制中生效。学生可以在正式提交前进行本地评测，
   * 每轮有一定概率发现并修复 bug，从而恢复部分已失分数。
   * ======================================================================== */

  /**
   * 模拟本地评测过程
   * @param {Object} student - 学生对象
   * @param {Object} problem - 题目状态对象 { maxScore, actualScore }
   * @param {number} rounds - 本地评测轮次（通常 format.localTestRounds = 2）
   * @returns {number} 修复的分数总量
   */
  RealContestEngine.simulateLocalTesting = function (student, problem, rounds) {
    // 无轮次则直接返回
    if (!rounds || rounds <= 0 || !problem) {
      return 0;
    }

    // 每轮发现并修复 bug 的概率取决于代码能力
    // coding 范围 30~200+，映射到 0.15~1.0
    var fixChance = (student.coding || 50) / 200;
    var totalFixed = 0;

    for (var i = 0; i < rounds; i++) {
      if (Math.random() < fixChance) {
        // 修复量：每轮最多恢复 maxScore 的 10%
        var fixAmount = Math.floor(problem.maxScore * LOCAL_TEST_FIX_RATIO * Math.random());
        totalFixed += fixAmount;
      }
    }

    return totalFixed;
  };

  /* ========================================================================
   * 第 5 节：构建比赛配置 — buildContestConfig
   * -----------------------------------------------------------------------
   * 将 REAL_CONTEST_SCHEDULE 中的比赛定义转换为模拟器可用的配置对象，
   * 同时附加赛制元数据（format / formatDef）。
   * ======================================================================== */

  /**
   * 根据比赛定义构建兼容 CompetitionEngine 的配置对象
   * @param {Object} contestDef - 比赛定义（REAL_CONTEST_SCHEDULE 中的条目）
   * @param {number} week - 当前周数
   * @returns {Object} 比赛配置对象
   */
  RealContestEngine.buildContestConfig = function (contestDef, week) {
    var problems = [];

    for (var i = 0; i < contestDef.problems; i++) {
      // 取预设的难度值，如果没有则默认 100
      var diff = (contestDef.problemDifficulties && contestDef.problemDifficulties[i])
        ? contestDef.problemDifficulties[i]
        : 100;

      // 平均分配每题满分，最后一题取剩余分数
      var maxScore = Math.floor(contestDef.totalMaxScore / contestDef.problems);
      if (i === contestDef.problems - 1) {
        maxScore = contestDef.totalMaxScore - maxScore * (contestDef.problems - 1);
      }

      // 根据比赛的 problemTypes 生成题目需求量
      var problemTypes = contestDef.problemTypes || [];
      var typeDef = (problemTypes[i]) ? problemTypes[i] : null;
      var demands = RealContestEngine._generateDemands(diff, typeDef);

      problems.push({
        id: i,           // 题目索引作为 ID
        difficulty: diff,
        maxScore: maxScore,
        demands: demands,
        // 保留 tags 供向后兼容
        tags: [demands.primaryType].concat(demands.secondaryType ? [demands.secondaryType] : []),
        thinkingBase: demands.thinking,
        codingBase: demands.coding,
        // subtasks 在模拟器初始化时生成
        subtasks: []
      });
    }

    return {
      name: contestDef.name || contestDef.id,
      contestDef: contestDef,
      format: contestDef.format,
      formatDef: (typeof CONTEST_FORMATS !== 'undefined')
        ? (CONTEST_FORMATS[contestDef.format] || CONTEST_FORMATS.OI)
        : { hasScoreLoss: false },
      problems: problems,
      totalMaxScore: contestDef.totalMaxScore,
      duration: contestDef.duration * 60,  // 小时 → 分钟
      tickInterval: TICK_INTERVAL,
      week: week
    };
  };

  /* ========================================================================
   * 第 6 节：比赛模拟器 — RealContestSimulator
   * -----------------------------------------------------------------------
   * 核心模拟器类。每个 tick 代表 10 分钟比赛时间。
   * 遵循与原始 ContestSimulator 相似的事件循环：
   *   start → runTick（× N） → finish → onFinish 回调
   *
   * 状态机（每个学生每个 tick）：
   *   1. 性格特殊效果（如强最优解型前 3 tick 打模板）
   *   2. 选题（_selectProblem）
   *   3. 思考 + 尝试 subtask（_attemptSubtask）
   *   4. 判断是否跳题（_shouldSkip）
   *   5. 更新总分
   *
   * 比赛结束后：
   *   - OI 赛制：应用挂分（calculateScoreLoss）
   *   - SELF_EVAL 赛制：应用本地评测加成（simulateLocalTesting）
   *   - 所有赛制：应用性格得分修正（applyScoreModifier）
   * ======================================================================== */

  /**
   * 构造函数
   * @param {Object} config - 比赛配置（buildContestConfig 的返回值）
   * @param {Array} students - 参赛学生数组
   * @param {Object} game - 游戏状态对象
   */
  RealContestEngine.RealContestSimulator = function (config, students, game) {
    this.config = config;
    this.students = students;
    this.game = game;
    this.formatDef = config.formatDef || { hasScoreLoss: false };
    this.contestDef = config.contestDef;

    // 时间状态
    this.tick = 0;
    this.maxTicks = Math.floor(config.duration / TICK_INTERVAL);
    this.running = false;
    this.finished = false;

    // 每个学生的比赛状态
    this.studentStates = {};

    // 日志
    this.log = [];

    // 回调
    this.onFinish = null;
    this.onTick = null;

    // 初始化每个学生的状态
    for (var i = 0; i < students.length; i++) {
      var s = students[i];
      var name = s.name;

      this.studentStates[name] = {
        student: s,
        totalScore: 0,
        maxScore: config.totalMaxScore,
        problems: [],
        currentProblem: -1,       // 当前正在做的题目索引，-1 表示未选题
        lastProblemIndex: -1,     // 最近做过的题目索引（用于日志回退）
        thinkingTime: 0,           // 当前题目已思考时间（分钟）
        recentlySkipped: 0,       // 最近跳题次数（用于防止反复跳同一题）
        finished: false,          // 该学生是否已完成所有能做的题
        localTestsUsed: 0,        // 已使用的本地评测轮次（SELF_EVAL 用）
        contestStartDelayDone: false,  // 强最优解型选手是否完成了模板阶段
        // talent.js 兼容接口：按索引返回题目对象（含 tags, maxScore 等字段）
        getProblem: function(pid) {
          return this.problems[pid] || null;
        }
      };

      // 为每道题生成 subtask 并初始化状态
      for (var j = 0; j < config.problems.length; j++) {
        var probDef = config.problems[j];
        this.studentStates[name].problems.push({
          id: j,
          tags: probDef.tags,
          demands: probDef.demands,     // 题目需求量（思维/代码/5大知识点）
          maxScore: probDef.maxScore,
          actualScore: 0,           // 当前已获得的分数
          solved: false,             // 是否满分通过（AC）
          currentSubtask: 0,        // 当前正在尝试的 subtask 索引
          subtasks: RealContestEngine._generateSubtasks(
            probDef.maxScore,
            probDef.difficulty,
            probDef.thinkingBase,
            probDef.codingBase
          )
        });
      }
    }
  };

  /* ----- 启动模拟 ----- */

  /**
   * 开始比赛模拟
   */
  RealContestEngine.RealContestSimulator.prototype.start = function () {
    this.running = true;
    this.finished = false;

    // 初始化每场比赛的心理快照（constmental）
    // 与原始 ContestSimulator.start 的逻辑保持一致
    for (var i = 0; i < this.students.length; i++) {
      var s = this.students[i];
      try {
        s._talent_state = s._talent_state || {};
        if (typeof s._talent_state.constmental === 'undefined') {
          s._talent_state.constmental = Number(s.mental || 50);
        }
      } catch (e) { /* ignore */ }
    }

    // 触发比赛开始事件（供天赋系统使用）
    for (var j = 0; j < this.students.length; j++) {
      var st = this.students[j];
      if (typeof st.triggerTalents === 'function') {
        try {
          var results = st.triggerTalents('contest_start', {
            contestName: this.config.name,
            state: this.studentStates[st.name]
          }) || [];
          if (results && results.length) {
            for (var k = 0; k < results.length; k++) {
              if (results[k] && results[k].result) {
                this._addLog(results[k].result, 'talent', st.name);
              }
            }
          }
        } catch (e) {
          console.error('[RealContestSimulator] triggerTalents contest_start error:', e);
        }
      }
    }

    // 慢热型选手效果记录
    // 慢热型在比赛前半段扣分、后半段加分
    // 此处不直接修改，在 finish 时通过 PersonalityManager.applyScoreModifier 统一处理

    // 开始第一个 tick
    this.runTick();
  };

  /* ----- 暂停模拟 ----- */

  RealContestEngine.RealContestSimulator.prototype.pause = function () {
    this.running = false;
  };

  /* ----- 单 tick 模拟 ----- */

  /**
   * 执行一个 tick（10 分钟）的模拟
   */
  RealContestEngine.RealContestSimulator.prototype.runTick = function () {
    if (!this.running || this.tick >= this.maxTicks) {
      this.finish();
      return;
    }

    var tickLog = [];

    for (var name in this.studentStates) {
      if (!this.studentStates.hasOwnProperty(name)) continue;
      var state = this.studentStates[name];
      if (state.finished) continue;

      var student = state.student;

      // === 特殊性格效果：强最优解型选手固定时间打模板 ===
      var startDelay = 0;
      var solvingSpeedBonus = 0;
      if (typeof PersonalityManager !== 'undefined' && typeof PersonalityManager.getVisibleEffect === 'function') {
        startDelay = PersonalityManager.getVisibleEffect(student, 'contestStartDelay') || 0;
        solvingSpeedBonus = PersonalityManager.getVisibleEffect(student, 'problemSolvingSpeedBonus') || 0;
      }
      // startDelay 是分钟数，TICK_INTERVAL 是每个 tick 的分钟数
      var delayTicks = startDelay > 0 ? Math.ceil(startDelay / TICK_INTERVAL) : 0;
      if (delayTicks > 0 && this.tick < delayTicks && !state.contestStartDelayDone) {
        tickLog.push({
          type: 'info',
          student: name,
          tick: this.tick,
          message: name + ' 正在打模板...'
        });
        continue;  // 跳过本次 tick
      }
      // 模板阶段结束后标记
      if (delayTicks > 0 && this.tick >= delayTicks && !state.contestStartDelayDone) {
        state.contestStartDelayDone = true;
        tickLog.push({
          type: 'info',
          student: name,
          tick: this.tick,
          message: name + ' 模板准备完毕，开始做题!'
        });
      }

      // === 选题阶段 ===
      if (state.currentProblem === -1 || state.currentProblem >= this.config.problems.length) {
        var selected = this._selectProblem(state, student);
        if (selected === -1) {
          // 没有可选题目，标记完成
          state.finished = true;
          tickLog.push({
            type: 'info',
            student: name,
            tick: this.tick,
            message: name + ' 已完成所有可做的题目'
          });
          continue;
        }
        state.currentProblem = selected;
        state.lastProblemIndex = selected;
        state.thinkingTime = 0;
        tickLog.push({
          type: 'select',
          student: name,
          tick: this.tick,
          message: name + ' 选择了第' + (selected + 1) + '题'
        });

        // 触发选题天赋事件
        if (typeof student.triggerTalents === 'function') {
          try {
            var talentResults = student.triggerTalents('contest_select_problem', {
              contestName: this.config.name,
              problemId: selected,
              state: state
            });
            if (talentResults && talentResults.length) {
              for (var t = 0; t < talentResults.length; t++) {
                if (talentResults[t] && talentResults[t].result) {
                  tickLog.push({
                    type: 'talent',
                    student: name,
                    tick: this.tick,
                    message: talentResults[t].result
                  });
                }
              }
            }
          } catch (e) { /* ignore */ }
        }
      }

      // === 思考 + 尝试 subtask ===
      var prob = state.problems[state.currentProblem];
      if (!prob) {
        state.currentProblem = -1;
        continue;
      }

      // 如果已 AC，移到下一题
      if (prob.solved) {
        state.currentProblem = -1;
        state.thinkingTime = 0;
        continue;
      }

      // 增加思考时间（基于需求匹配的速度倍率）
      var tickTime = TICK_INTERVAL;
      // 强最优解型选手：模板完成后做题速度+30%（thinkingTime 增加更快）
      if (solvingSpeedBonus > 0 && state.contestStartDelayDone) {
        tickTime = Math.floor(tickTime * (1.0 + solvingSpeedBonus));
      }
      // 根据学生能力与题目需求对比计算速度倍率
      var probDef = this.config.problems[state.currentProblem];
      var speedMult = RealContestEngine._calcSpeedMultiplier(student, {
        demands: probDef ? probDef.demands : null
      });
      state.thinkingTime += Math.floor(tickTime * speedMult);

      // 触发思考天赋事件
      if (typeof student.triggerTalents === 'function') {
        try {
          var thinkResults = student.triggerTalents('contest_thinking', {
            contestName: this.config.name,
            problemId: state.currentProblem,
            thinkingTime: state.thinkingTime,
            state: state
          });
          // 处理特殊 action（如卡卡就过了 → auto_pass_problem）
          var autoPassed = false;
          if (thinkResults && thinkResults.length) {
            for (var tr = 0; tr < thinkResults.length; tr++) {
              if (!thinkResults[tr] || !thinkResults[tr].result) continue;
              var out = thinkResults[tr].result;
              if (typeof out === 'object' && out.action === 'auto_pass_problem') {
                // 直接通过当前题的最后一档
                var lastSub = prob.subtasks[prob.subtasks.length - 1];
                if (lastSub) {
                  prob.actualScore = lastSub.score;
                  prob.currentSubtask = prob.subtasks.length;
                  prob.solved = true;
                  tickLog.push({
                    type: 'talent',
                    student: name,
                    tick: this.tick,
                    message: out.message || '卡卡就过了：直接通过此题'
                  });
                  autoPassed = true;
                }
              } else if (typeof out === 'string') {
                tickLog.push({ type: 'talent', student: name, tick: this.tick, message: out });
              } else if (typeof out === 'object' && out.message) {
                tickLog.push({ type: 'talent', student: name, tick: this.tick, message: out.message });
              }
            }
          }
          if (autoPassed) {
            var solvedIdx = state.currentProblem;
            state.currentProblem = -1;
            tickLog.push({
              type: 'solve',
              student: name,
              tick: this.tick,
              message: name + ' AC了第' + (solvedIdx + 1) + '题! (+' + prob.maxScore + ')'
            });
            continue;
          }
        } catch (e) { /* ignore */ }
      }

      // 选择 subtask 尝试
      var subtaskIdx = this._selectSubtask(student, prob, state.thinkingTime);
      if (subtaskIdx === null || subtaskIdx < 0) {
        // 没有可尝试的档位
        state.currentProblem = -1;
        continue;
      }

      var subtask = prob.subtasks[subtaskIdx];
      if (!subtask) {
        state.currentProblem = -1;
        continue;
      }

      // 尝试解决
      var attemptResult = this._attemptSubtask(student, prob, subtask);

      if (attemptResult.passed) {
        // 更新分数（只取更高的分数）
        if (subtask.score > prob.actualScore) {
          prob.actualScore = subtask.score;
        }
        prob.currentSubtask = subtaskIdx + 1;

        // 检查是否 AC
        if (prob.actualScore >= prob.maxScore) {
          prob.solved = true;
          var solvedIdx = state.currentProblem;
          state.currentProblem = -1;
          tickLog.push({
            type: 'solve',
            student: name,
            tick: this.tick,
            message: name + ' AC了第' + (solvedIdx + 1) + '题! (+' + prob.maxScore + ')'
          });

          // 触发过题天赋事件
          if (typeof student.triggerTalents === 'function') {
            try {
              var solveResults = student.triggerTalents('contest_solve_problem', {
                contestName: this.config.name,
                problemId: solvedIdx,
                state: state
              });
              if (solveResults && solveResults.length) {
                for (var sr = 0; sr < solveResults.length; sr++) {
                  if (solveResults[sr] && solveResults[sr].result) {
                    tickLog.push({ type: 'talent', student: name, tick: this.tick, message: solveResults[sr].result });
                  }
                }
              }
            } catch (e) { /* ignore */ }
          }
        } else {
          tickLog.push({
            type: 'subtask',
            student: name,
            tick: this.tick,
            message: name + ' 通过了第' + (this._lastProblemIndex(state) + 1) + '题的第' + (subtaskIdx + 1) + '档 (' + subtask.score + '分)'
          });

          // 触发通过 subtask 天赋事件
          if (typeof student.triggerTalents === 'function') {
            try {
              var passResults = student.triggerTalents('contest_pass_subtask', {
                contestName: this.config.name,
                problemId: this._lastProblemIndex(state),
                subtaskIdx: subtaskIdx,
                score: subtask.score,
                state: state
              });
              if (passResults && passResults.length) {
                for (var pr = 0; pr < passResults.length; pr++) {
                  if (passResults[pr] && passResults[pr].result) {
                    tickLog.push({ type: 'talent', student: name, tick: this.tick, message: passResults[pr].result });
                  }
                }
              }
            } catch (e) { /* ignore */ }
          }
        }
      } else {
        // 未通过

        // 判断是否跳题
        if (this._shouldSkip(state, student, prob)) {
          state.recentlySkipped++;
          var skipProblemIdx = this._lastProblemIndex(state);
          tickLog.push({
            type: 'skip',
            student: name,
            tick: this.tick,
            message: name + ' 在第' + (skipProblemIdx + 1) + '题上卡住太久，决定跳题'
          });
          state.currentProblem = -1;
          state.thinkingTime = 0;

          // 触发跳题天赋事件
          if (typeof student.triggerTalents === 'function') {
            try {
              var skipResults = student.triggerTalents('contest_skip_problem', {
                contestName: this.config.name,
                problemId: skipProblemIdx,
                state: state
              });
              if (skipResults && skipResults.length) {
                for (var sk = 0; sk < skipResults.length; sk++) {
                  if (skipResults[sk] && skipResults[sk].result) {
                    tickLog.push({ type: 'talent', student: name, tick: this.tick, message: skipResults[sk].result });
                  }
                }
              }
            } catch (e) { /* ignore */ }
          }
        }
      }

      // 更新总分
      var total = 0;
      for (var p = 0; p < state.problems.length; p++) {
        total += state.problems[p].actualScore;
      }
      state.totalScore = total;
    }

    // 合并日志
    this.log = this.log.concat(tickLog);

    // 推进 tick
    this.tick++;

    // 触发 tick 回调
    if (typeof this.onTick === 'function') {
      this.onTick(this.tick, this.maxTicks);
    }

    // 检查是否全部结束
    var allFinished = true;
    for (var n in this.studentStates) {
      if (this.studentStates.hasOwnProperty(n) && !this.studentStates[n].finished) {
        allFinished = false;
        break;
      }
    }

    if (allFinished || this.tick >= this.maxTicks) {
      this.finish();
    }
    // 不在此处自动调度下一个 tick，由外部渲染层定时器统一驱动
  };

  /* ========================================================================
   * 第 7 节：比赛结束处理 — finish
   * -----------------------------------------------------------------------
   * 在所有 tick 结束后执行：
   *   1. OI 赛制：对每道已得分题目应用挂分机制
   *   2. SELF_EVAL 赛制：应用本地评测修复
   *   3. 应用性格得分修正器
   *   4. 计算最终得分
   *   5. 触发 onFinish 回调
   * ======================================================================== */

  RealContestEngine.RealContestSimulator.prototype.finish = function () {
    this.finished = true;
    this.running = false;

    var contestType = 'formal';  // 默认正式赛
    // 如果 contestDef.id 为 'mock'，则为模拟赛
    if (this.contestDef && this.contestDef.id === 'mock') {
      contestType = 'mock';
    }

    for (var name in this.studentStates) {
      if (!this.studentStates.hasOwnProperty(name)) continue;
      var state = this.studentStates[name];
      var student = state.student;

      // === OI 赛制：挂分处理 ===
      if (this.formatDef && this.formatDef.hasScoreLoss) {
        for (var i = 0; i < state.problems.length; i++) {
          var prob = state.problems[i];
          if (prob.actualScore > 0) {
            var result = RealContestEngine.calculateScoreLoss(student, prob, this.formatDef);
            if (result.loss > 0) {
              prob.originalScore = prob.actualScore;
              prob.mistakePenalty = result.loss;
              prob.mistakeReason = result.reason || '';
              prob.actualScore = Math.max(0, prob.actualScore - result.loss);
              this._addLog(
                name + ' \u7684\u7b2c' + (i + 1) + '\u9898\u6302\u5206\u4e86! (-' + result.loss + ', ' + (result.reason || '') + ')',
                'warning', name
              );
            }
          }
        }
      }

      // === SELF_EVAL 赛制：本地评测修复 ===
      if (this.formatDef && this.formatDef.localTestRounds) {
        var rounds = this.formatDef.localTestRounds;
        for (var j = 0; j < state.problems.length; j++) {
          var probJ = state.problems[j];
          if (probJ.actualScore < probJ.maxScore) {
            var fix = RealContestEngine.simulateLocalTesting(student, probJ, rounds);
            if (fix > 0) {
              probJ.actualScore = Math.min(probJ.maxScore, probJ.actualScore + fix);
              this._addLog(
                name + ' 的第' + (j + 1) + '题通过本地评测修复了 ' + fix + ' 分',
                'info', name
              );
            }
          }
        }
      }

      // === IOI 赛制：实时反馈 → 学生可以根据反馈调整策略 ===
      // IOI 赛制没有挂分也没有本地评测，但反馈模式可能影响策略
      // 当前实现中，IOI 的策略优势体现在 _selectSubtask 中可以更激进地尝试高档位
      // （因为实时反馈允许学生知道当前提交是否正确）

      // 重新计算总分
      var totalScore = 0;
      for (var k = 0; k < state.problems.length; k++) {
        totalScore += state.problems[k].actualScore;
      }
      state.totalScore = totalScore;

      // === 逐题应用性格得分修正 ===
      if (typeof PersonalityManager !== 'undefined' && typeof PersonalityManager.applyScoreModifier === 'function') {
        var modifiedTotal = 0;
        for (var k = 0; k < state.problems.length; k++) {
          var prob = state.problems[k];
          var modScore = PersonalityManager.applyScoreModifier(student, prob.actualScore, contestType, prob.maxScore);
          prob.finalScore = modScore;  // 保存修正后的单题分数
          modifiedTotal += modScore;
        }
        state.finalScore = modifiedTotal;
      } else {
        for (var k = 0; k < state.problems.length; k++) {
          state.problems[k].finalScore = state.problems[k].actualScore;
        }
        state.finalScore = totalScore;
      }
    }

    // 触发完成回调
    if (typeof this.onFinish === 'function') {
      this.onFinish(this.studentStates, this.config, this.log);
    }
  };

  /* ========================================================================
   * 第 8 节：内部辅助方法（私有）
   * ======================================================================== */

  /**
   * 生成 subtask 档位
   * 与原始 generateSubtasks 逻辑一致，但使用 ES5 语法
   *
   * @param {number} totalScore - 题目满分
   * @param {number} problemDifficulty - 题目难度
   * @param {number} thinkingBase - 思维基础难度（可选）
   * @param {number} codingBase - 代码基础难度（可选）
   * @returns {Array} subtask 数组 [{score, difficulty, thinkingDifficulty, codingDifficulty}]
   */
  RealContestEngine._generateSubtasks = function (totalScore, problemDifficulty, thinkingBase, codingBase) {
    var numSubtasks = MIN_SUBTASKS + Math.floor(getRandom() * (MAX_SUBTASKS - MIN_SUBTASKS + 1));
    var subtasks = [];

    for (var i = 1; i <= numSubtasks; i++) {
      var score, difficulty;

      if (i === numSubtasks) {
        // 最后一档：满分，难度 = 题目难度
        score = totalScore;
        difficulty = problemDifficulty;
      } else {
        // 前面的档位：均匀分割分数
        score = Math.floor(totalScore * i / numSubtasks);
        // 难度使用指数曲线：0.35 + 0.65 * progress^1.8
        var progress = i / numSubtasks;
        var difficultyRatio = SUBTASK_MIN_DIFF_RATIO + (1 - SUBTASK_MIN_DIFF_RATIO) * Math.pow(progress, SUBTASK_DIFF_EXPONENT);
        difficulty = Math.floor(problemDifficulty * difficultyRatio);
      }

      // 生成思维 / 代码专用难度
      var thinkBase = (typeof thinkingBase === 'number') ? thinkingBase : difficulty;
      var codeBase = (typeof codingBase === 'number') ? codingBase : difficulty;

      if (numSubtasks > 1 && i < numSubtasks) {
        var subProgress = i / numSubtasks;
        var diffScale = SUBTASK_MIN_DIFF_RATIO + (1 - SUBTASK_MIN_DIFF_RATIO) * Math.pow(subProgress, SUBTASK_DIFF_EXPONENT);
        thinkBase = Math.floor(thinkBase * diffScale);
        codeBase = Math.floor(codeBase * diffScale);
      }

      // 难度加成（与原始引擎的 THINKING_DIFFICULTY_BONUS / CODING_DIFFICULTY_BONUS 一致）
      var thinkBonus = (typeof THINKING_DIFFICULTY_BONUS === 'number') ? THINKING_DIFFICULTY_BONUS : 0.0;
      var codeBonus = (typeof CODING_DIFFICULTY_BONUS === 'number') ? CODING_DIFFICULTY_BONUS : 0.0;

      var thinkingDifficulty = Math.max(1, Math.floor(thinkBase * (1.0 + thinkBonus)));
      var codingDifficulty = Math.max(1, Math.floor(codeBase * (1.0 + codeBonus)));

      subtasks.push({
        score: score,
        difficulty: difficulty,
        thinkingDifficulty: thinkingDifficulty,
        codingDifficulty: codingDifficulty
      });
    }

    return subtasks;
  };

  /**
   * 根据题目难度和算法类型生成需求量（demands）
   * demands 包含：thinking（思维需求）、coding（代码需求）、
   * ds（数据结构需求）、graph（图论需求）、string（字符串需求）、
   * math（数学需求）、dp（DP需求）、primaryType、secondaryType
   *
   * @param {number} difficulty - 题目难度值
   * @param {Object} typeDef - { type: 主算法, secondary: 副算法, secondary2: 第三算法 }
   * @returns {Object} demands 对象
   */
  RealContestEngine._generateDemands = function (difficulty, typeDef) {
    var TYPE_KEY_MAP = {
      '数据结构': 'ds',
      '图论':     'graph',
      '字符串':   'string',
      '数学':     'math',
      'DP':       'dp'
    };

    // 若未指定类型，随机选一个
    var primaryType = (typeDef && typeDef.type) ? typeDef.type : 'DP';
    var secondaryType = (typeDef && typeDef.secondary) ? typeDef.secondary : null;
    var secondary2Type = (typeDef && typeDef.secondary2) ? typeDef.secondary2 : null;

    // 基础需求
    var thinking = Math.max(1, Math.floor(difficulty * 0.7));
    var coding   = Math.max(1, Math.floor(difficulty * 0.5));

    // 知识需求初始化
    var ds = 0, graph = 0, string = 0, math = 0, dp = 0;

    // 主算法需求：难度 × 0.6
    var primaryKey = TYPE_KEY_MAP[primaryType];
    if (primaryKey) {
      var obj = { ds: 'ds', graph: 'graph', string: 'string', math: 'math', dp: 'dp' };
      if (primaryKey === 'ds') ds = Math.max(1, Math.floor(difficulty * 0.6));
      else if (primaryKey === 'graph') graph = Math.max(1, Math.floor(difficulty * 0.6));
      else if (primaryKey === 'string') string = Math.max(1, Math.floor(difficulty * 0.6));
      else if (primaryKey === 'math') math = Math.max(1, Math.floor(difficulty * 0.6));
      else if (primaryKey === 'dp') dp = Math.max(1, Math.floor(difficulty * 0.6));
    }

    // 副算法需求：难度 × 0.3
    var secKey = secondaryType ? TYPE_KEY_MAP[secondaryType] : null;
    if (secKey) {
      var secVal = Math.max(1, Math.floor(difficulty * 0.3));
      if (secKey === 'ds') ds = Math.max(ds, secVal);
      else if (secKey === 'graph') graph = Math.max(graph, secVal);
      else if (secKey === 'string') string = Math.max(string, secVal);
      else if (secKey === 'math') math = Math.max(math, secVal);
      else if (secKey === 'dp') dp = Math.max(dp, secVal);
    }

    // 第三算法需求（仅 NOI 级）：难度 × 0.15
    var sec2Key = secondary2Type ? TYPE_KEY_MAP[secondary2Type] : null;
    if (sec2Key) {
      var sec2Val = Math.max(1, Math.floor(difficulty * 0.15));
      if (sec2Key === 'ds') ds = Math.max(ds, sec2Val);
      else if (sec2Key === 'graph') graph = Math.max(graph, sec2Val);
      else if (sec2Key === 'string') string = Math.max(string, sec2Val);
      else if (sec2Key === 'math') math = Math.max(math, sec2Val);
      else if (sec2Key === 'dp') dp = Math.max(dp, sec2Val);
    }

    return {
      thinking: thinking,
      coding: coding,
      ds: ds,
      graph: graph,
      string: string,
      math: math,
      dp: dp,
      primaryType: primaryType,
      secondaryType: secondaryType
    };
  };

  /**
   * 根据题目难度随机分配知识点标签（向后兼容，仅供无 problemTypes 时使用）
   * @param {number} difficulty - 题目难度值
   * @returns {Array} 知识点中文名标签数组
   */
  RealContestEngine._randomTags = function (difficulty) {
    var allTags = ['数据结构', '图论', '字符串', '数学', 'DP'];

    // 根据难度偏好选择标签
    var tagCount = 1;
    if (difficulty > 80) tagCount = 2;

    var selected = [];
    var pool = allTags.slice(); // 浅拷贝

    for (var i = 0; i < tagCount && pool.length > 0; i++) {
      var idx = Math.floor(Math.random() * pool.length);
      selected.push(pool[idx]);
      pool.splice(idx, 1); // 移除已选标签避免重复
    }

    return selected;
  };

  /**
   * 获取学生对某题目的相关知识值
   * 优先使用 demands 系统进行需求加权计算，回退到 tags
   *
   * @param {Object} student - 学生对象
   * @param {Object} problem - 题目对象（含 demands 或 tags）
   * @returns {number} 有效知识值
   */
  RealContestEngine._getKnowledgeForProblem = function (student, problem) {
    if (!student || !problem) return 0;

    // 优先使用 demands 系统进行需求加权
    if (problem.demands) {
      var dm = problem.demands;
      var weightedSum = 0;
      var totalDemand = 0;

      var demandKeys = ['ds', 'graph', 'string', 'math', 'dp'];
      var knowledgeKeys = ['knowledge_ds', 'knowledge_graph', 'knowledge_string', 'knowledge_math', 'knowledge_dp'];

      for (var d = 0; d < demandKeys.length; d++) {
        var dem = dm[demandKeys[d]] || 0;
        if (dem > 0) {
          weightedSum += (student[knowledgeKeys[d]] || 0) * dem;
          totalDemand += dem;
        }
      }

      if (totalDemand > 0) {
        return weightedSum / totalDemand;
      }
    }

    // 回退到 tags 系统
    if (!problem.tags || problem.tags.length === 0) {
      return 0;
    }

    var total = 0;
    var count = 0;

    for (var i = 0; i < problem.tags.length; i++) {
      var tag = problem.tags[i];
      var knowledgeKey = null;
      if (tag === '数据结构') knowledgeKey = 'knowledge_ds';
      else if (tag === '图论') knowledgeKey = 'knowledge_graph';
      else if (tag === '字符串') knowledgeKey = 'knowledge_string';
      else if (tag === '数学') knowledgeKey = 'knowledge_math';
      else if (tag === 'DP') knowledgeKey = 'knowledge_dp';

      if (knowledgeKey && typeof student[knowledgeKey] === 'number') {
        total += student[knowledgeKey];
        count++;
      }
    }

    return count > 0 ? (total / count) : 0;
  };

  /**
   * 计算需求匹配速度倍率
   * 对比学生能力/知识值与题目需求量，得出做题速度倍率
   * 倍率 > 1 表示学生能力超出需求，做题更快
   * 倍率 < 1 表示学生能力不足，做题更慢
   * 范围 [0.2, 3.0]
   *
   * @param {Object} student - 学生对象
   * @param {Object} problem - 题目状态对象（含 demands）
   * @returns {number} 速度倍率
   */
  RealContestEngine._calcSpeedMultiplier = function (student, problem) {
    if (!student || !problem || !problem.demands) return 1.0;

    var dm = problem.demands;
    var demandRatio = 0;
    var demandCount = 0;

    // 思维需求匹配
    var thinkDem = Math.max(1, dm.thinking || 1);
    demandRatio += (student.thinking || 0) / thinkDem;
    demandCount++;

    // 代码需求匹配
    var codeDem = Math.max(1, dm.coding || 1);
    demandRatio += (student.coding || 0) / codeDem;
    demandCount++;

    // 知识需求匹配
    var demandKeys = ['ds', 'graph', 'string', 'math', 'dp'];
    var knowledgeKeys = ['knowledge_ds', 'knowledge_graph', 'knowledge_string', 'knowledge_math', 'knowledge_dp'];

    for (var d = 0; d < demandKeys.length; d++) {
      var dem = dm[demandKeys[d]] || 0;
      if (dem > 0) {
        demandRatio += (student[knowledgeKeys[d]] || 0) / dem;
        demandCount++;
      }
    }

    if (demandCount === 0) return 1.0;

    var avgRatio = demandRatio / demandCount;
    // 映射到 [0.2, 3.0]：ratio < 1 线性缩减，ratio > 1 线性增长但有上限
    var speedMult;
    if (avgRatio >= 1.0) {
      speedMult = 1.0 + (avgRatio - 1.0) * 1.0;  // ratio 2 → speed 2.0
    } else {
      speedMult = 0.2 + avgRatio * 0.8;  // ratio 0.5 → speed 0.6, ratio 0 → speed 0.2
    }
    return Math.max(0.2, Math.min(3.0, speedMult));
  };

  /**
   * 选题策略 — 轮盘赌加权随机
   * 简单题、靠前的题目权重更高
   *
   * @param {Object} state - 学生的比赛状态
   * @param {Object} student - 学生对象
   * @returns {number} 选中题目的索引，-1 表示无题可选
   */
  RealContestEngine.RealContestSimulator.prototype._selectProblem = function (state, student) {
    var unsolvedIndices = [];
    var weights = [];

    for (var i = 0; i < this.config.problems.length; i++) {
      if (state.problems[i] && !state.problems[i].solved) {
        unsolvedIndices.push(i);
      }
    }

    if (unsolvedIndices.length === 0) return -1;

    // 如果有「稳扎稳打」天赋，严格按顺序选题
    if (student.hasTalent && student.hasTalent('稳扎稳打')) {
      return unsolvedIndices[0];
    }

    // 计算每个未解题目的权重
    var knowledge = student.getKnowledgeTotal ? student.getKnowledgeTotal() : 50;
    var ability = student.getComprehensiveAbility ? student.getComprehensiveAbility() : 50;
    var effectiveAbility = ability + knowledge * 0.5;

    var totalWeight = 0;
    for (var j = 0; j < unsolvedIndices.length; j++) {
      var pIdx = unsolvedIndices[j];
      var prob = state.problems[pIdx];
      if (!prob || !prob.subtasks || prob.subtasks.length === 0) continue;

      // 取最简单档位的难度作为参考
      var easiestDiff = prob.subtasks[0].difficulty;

      // 难度差距 → 基础评分
      var gap = easiestDiff - effectiveAbility;
      var baseScore = 100;

      if (gap <= -20) baseScore += 80;       // 非常简单
      else if (gap <= 0) baseScore += 60;     // 简单
      else if (gap <= 20) baseScore += 40;    // 适中
      else if (gap <= 40) baseScore += 20;    // 较难
      else baseScore += 10;                    // 很难

      // 位置加权：靠前的题目额外加分
      var posBonus = POSITION_BONUS_BASE - (pIdx * POSITION_BONUS_STEP);
      baseScore += Math.max(0, posBonus);

      var weight = Math.max(1, baseScore);
      weights.push(weight);
      totalWeight += weight;
    }

    if (totalWeight <= 0) return unsolvedIndices[0];

    // 轮盘赌选择
    var rand = getRandom() * totalWeight;
    for (var k = 0; k < unsolvedIndices.length; k++) {
      rand -= weights[k];
      if (rand <= 0) {
        return unsolvedIndices[k];
      }
    }

    return unsolvedIndices[0];
  };

  /**
   * 选择 subtask 尝试
   * 与原始引擎的 selectBestSubtask 逻辑类似但简化：
   *   - 计算每个档位的能力匹配度
   *   - 80% 选最佳 / 15% 选次佳 / 5% 随机
   *   - IOI 赛制更激进（因为实时反馈）
   *
   * @param {Object} student - 学生对象
   * @param {Object} prob - 题目状态对象
   * @param {number} thinkingTime - 当前题目已思考时间（分钟）
   * @returns {number|null} subtask 索引
   */
  RealContestEngine.RealContestSimulator.prototype._selectSubtask = function (student, prob, thinkingTime) {
    if (!prob || !prob.subtasks || prob.subtasks.length === 0) return null;

    // 只考虑当前进度及之后的档位（不允许回退到已通过的档位）
    var startIdx = prob.currentSubtask || 0;
    if (startIdx >= prob.subtasks.length) return null;

    var knowledge = RealContestEngine._getKnowledgeForProblem(student, prob);
    var thinking = Number(student.thinking || 50);
    var coding = Number(student.coding || 50);

    // 如果学生有「激进」天赋，只尝试最后一档
    if (student.hasTalent && student.hasTalent('激进')) {
      var lastIdx = prob.subtasks.length - 1;
      return lastIdx >= startIdx ? lastIdx : null;
    }

    // IOI 赛制：由于实时反馈，更倾向尝试当前进度对应的下一档
    var isIOI = this.formatDef && this.formatDef.feedbackMode === 'realtime';

    // 评分每个档位（仅从 startIdx 开始）
    var scored = [];
    for (var i = startIdx; i < prob.subtasks.length; i++) {
      var st = prob.subtasks[i];
      var thinkDiff = Number(st.thinkingDifficulty || st.difficulty || 0);
      var codeDiff = Number(st.codingDifficulty || st.difficulty || 0);

      var thinkRatio = (thinking + knowledge * THINKING_KNOWLEDGE_COEFF) / Math.max(1, thinkDiff);
      var codeRatio = (coding + knowledge * CODING_KNOWLEDGE_COEFF) / Math.max(1, codeDiff);

      // 匹配度评分
      var matchScore = 0;

      // 思维匹配
      if (thinkRatio >= 0.6 && thinkRatio <= 1.4) {
        matchScore += 100;
      } else if (thinkRatio > 1.4) {
        matchScore += Math.max(60, 100 - (thinkRatio - 1.4) * 40);
      } else {
        matchScore += Math.max(10, thinkRatio * 100);
      }

      // 代码匹配
      if (codeRatio >= 0.6 && codeRatio <= 1.4) {
        matchScore += 100;
      } else if (codeRatio > 1.4) {
        matchScore += Math.max(60, 100 - (codeRatio - 1.4) * 40);
      } else {
        matchScore += Math.max(10, codeRatio * 100);
      }

      // 分值权重
      var scoreWeight = st.score * 0.8;

      // 已获得分数的惩罚：不要重复尝试已通过的档位（强惩罚避免回退）
      var scorePenalty = 0;
      if (prob.actualScore > 0 && st.score <= prob.actualScore) {
        scorePenalty = -9999;
      }

      // IOI 赛制加分：可以更激进地尝试高档位
      var ioiBonus = isIOI ? 20 : 0;

      scored.push({
        idx: i,
        score: matchScore + scoreWeight + scorePenalty + ioiBonus,
        thinkRatio: thinkRatio,
        codeRatio: codeRatio
      });
    }

    // 排序
    scored.sort(function (a, b) { return b.score - a.score; });

    // 卡题降级策略（与原始引擎类似）
    var bestSub = scored[0];
    var isLast = bestSub && bestSub.idx === (prob.subtasks.length - 1);
    var cannotSolveFull = isLast && (bestSub.thinkRatio < 0.7 || bestSub.codeRatio < 0.7);

    // 根据思考时间决定是否降级
    var timeFactor = 0;
    if (thinkingTime >= 20) {
      timeFactor = Math.min(0.8, (thinkingTime - 20) / 40);
    }

    var shouldDowngrade = cannotSolveFull || (getRandom() < timeFactor);

    if (shouldDowngrade && scored.length > 1) {
      // 选择非最高档位中匹配度最好的（排除已得分档位）
      var lowerSubs = [];
      for (var s = 0; s < scored.length; s++) {
        if (scored[s].idx < prob.subtasks.length - 1 && scored[s].score > -9000) {
          lowerSubs.push(scored[s]);
        }
      }
      if (lowerSubs.length > 0) {
        var downgradeProb = cannotSolveFull ? 0.85 : (0.5 + timeFactor * 0.3);
        if (getRandom() < downgradeProb) {
          return lowerSubs[0].idx;
        }
      }
    }

    // 过滤掉已得分档位（score <= actualScore 的档位），确保不会回退
    var available = [];
    for (var av = 0; av < scored.length; av++) {
      if (scored[av].score > -9000) {
        available.push(scored[av]);
      }
    }
    if (available.length === 0) return null;

    // 80% 最佳 / 15% 次佳 / 5% 随机（仅在可用档位中选择）
    var rand = getRandom();
    if (rand < 0.80) {
      return available[0].idx;
    } else if (rand < 0.95 && available.length > 1) {
      return available[1].idx;
    } else {
      return available[Math.floor(getRandom() * available.length)].idx;
    }
  };

  /**
   * 尝试解决某个 subtask
   * 与原始引擎的 attemptSubtask 逻辑一致：
   *   - 思维检定（thinking + 知识 + 心理稳定性）
   *   - 代码检定（coding + 知识 + 心理稳定性）
   *   - 两者都通过才算成功
   *
   * @param {Object} student - 学生对象
   * @param {Object} problem - 题目状态对象
   * @param {Object} subtask - subtask 定义
   * @returns {Object} {passed: boolean}
   */
  RealContestEngine.RealContestSimulator.prototype._attemptSubtask = function (student, problem, subtask) {
    var knowledge = RealContestEngine._getKnowledgeForProblem(student, problem);

    // 获取心理值（优先使用 constmental）
    var mental = 50;
    try {
      if (student && student._talent_state && typeof student._talent_state.constmental !== 'undefined') {
        mental = Number(student._talent_state.constmental || 50);
      } else if (typeof student.getMentalIndex === 'function') {
        mental = student.getMentalIndex();
      } else {
        mental = Number(student.mental || 50);
      }
    } catch (e) {
      mental = Number(student.mental || 50);
    }

    var taskThinkDiff = Number(subtask.thinkingDifficulty || subtask.difficulty || 0);
    var taskCodeDiff = Number(subtask.codingDifficulty || subtask.difficulty || 0);

    // === 知识点门槛 ===
    var knowledgeReq = Math.max(KNOWLEDGE_REQUIREMENT_FLOOR, taskThinkDiff * KNOWLEDGE_REQUIREMENT_RATIO);
    var knowledgePenalty = 1.0;
    if (knowledge < knowledgeReq) {
      var gap = knowledgeReq - knowledge;
      knowledgePenalty = Math.exp(-gap / KNOWLEDGE_PENALTY_SCALE);
      knowledgePenalty = Math.max(KNOWLEDGE_PENALTY_FLOOR, knowledgePenalty);
    }

    // === 思维检定 ===
    var thinkBase = Number(student.thinking || 50) + knowledge * THINKING_KNOWLEDGE_COEFF;
    var thinkGap = thinkBase - taskThinkDiff;
    var thinkProb = 1.0 / (1.0 + Math.exp(-thinkGap / SIGMOID_SENSITIVITY));

    // 心理稳定性
    var thinkStability = THINKING_STABILITY_MIN + THINKING_STABILITY_RANGE * (mental / 100.0);
    thinkProb = thinkProb * thinkStability;
    thinkProb = thinkProb * knowledgePenalty;

    // === 代码检定 ===
    var codeBase = Number(student.coding || 50) + knowledge * CODING_KNOWLEDGE_COEFF;
    var codeGap = codeBase - taskCodeDiff;
    var codeProb = 1.0 / (1.0 + Math.exp(-codeGap / SIGMOID_SENSITIVITY));

    var codeStability = CODING_STABILITY_MIN + CODING_STABILITY_RANGE * (mental / 100.0);
    codeProb = codeProb * codeStability;
    codeProb = codeProb * knowledgePenalty;

    // === 天赋修正 ===
    thinkProb = this._applyTalentCheck(student, thinkProb, taskThinkDiff, 'thinking');
    codeProb = this._applyTalentCheck(student, codeProb, taskCodeDiff, 'coding');

    // === 综合判定 ===
    var thinkPassed = Math.random() < thinkProb;
    var codePassed = Math.random() < codeProb;

    return {
      passed: thinkPassed && codePassed,
      thinkProb: thinkProb,
      codeProb: codeProb
    };
  };

  /**
   * 应用天赋对检定概率的修正
   * @param {Object} student - 学生对象
   * @param {number} prob - 当前通过概率
   * @param {number} difficulty - 难度值
   * @param {string} checkType - 'thinking' 或 'coding'
   * @returns {number} 修正后的概率
   */
  RealContestEngine.RealContestSimulator.prototype._applyTalentCheck = function (student, prob, difficulty, checkType) {
    if (typeof student.triggerTalents !== 'function') return prob;

    try {
      var tRes = student.triggerTalents('contest_check_subtask', {
        difficulty: difficulty,
        checkType: checkType
      }) || [];

      for (var i = 0; i < tRes.length; i++) {
        var tr = tRes[i];
        if (!tr || !tr.result) continue;
        var out = tr.result;

        if (typeof out === 'object' && out.action) {
          if (out.action === 'boost_ability') {
            prob *= (1 + Number(out.amount || 0));
            if (out.message) this._addLog(out.message, 'talent', student.name);
          } else if (out.action === 'reduce_difficulty') {
            prob *= (1 + Number(out.amount || 0));
            if (out.message) this._addLog(out.message, 'talent', student.name);
          } else if (out.action === 'reduce_ability') {
            prob *= Math.max(0, 1 - Number(out.amount || 0));
            if (out.message) this._addLog(out.message, 'talent', student.name);
          } else if (out.message) {
            this._addLog(out.message, 'talent', student.name);
          }
        } else if (typeof out === 'string') {
          this._addLog(out, 'talent', student.name);
        }
      }
    } catch (e) {
      console.error('[RealContestSimulator] _applyTalentCheck error:', e);
    }

    return prob;
  };

  /**
   * 判断是否应该跳题
   * 基于在当前题目上已花费的思考时间，如果超过阈值则逐渐增加跳题概率
   *
   * @param {Object} state - 学生比赛状态
   * @param {Object} student - 学生对象
   * @param {Object} problem - 当前题目状态
   * @returns {boolean} 是否应该跳题
   */
  RealContestEngine.RealContestSimulator.prototype._shouldSkip = function (state, student, problem) {
    var thinkingTime = state.thinkingTime || 0;

    // 至少在当前题目上花了 SKIP_TIME_BASE 分钟才考虑跳题
    if (thinkingTime < SKIP_TIME_BASE) return false;

    // 如果已经有分数了，跳题概率降低
    var hasScore = problem && problem.actualScore > 0;

    // 超出基础时间后，每 10 分钟增加跳题概率
    var extraTime = thinkingTime - SKIP_TIME_BASE;
    var skipProb = Math.min(SKIP_PROB_MAX, (extraTime / 10) * SKIP_PROB_PER_TEN_MIN);

    // 已获得分数时降低 50% 的跳题倾向
    if (hasScore) {
      skipProb *= 0.5;
    }

    return Math.random() < skipProb;
  };

  /* ----- 日志辅助 ----- */

  /**
   * 添加日志条目
   * @param {string} message - 日志内容
   * @param {string} type - 日志类型（info/warning/talent/solve/select/skip/subtask）
   * @param {string} studentName - 学生名称
   */
  RealContestEngine.RealContestSimulator.prototype._addLog = function (message, type, studentName) {
    this.log.push({
      tick: this.tick,
      time: this.tick * TICK_INTERVAL,
      message: message,
      type: type || 'info',
      student: studentName || null,
      timestamp: Date.now()
    });
  };

  /**
   * 获取 state 最近正在做的题目索引（安全取值）
   * @param {Object} state - 学生比赛状态
   * @returns {number} 题目索引
   */
  RealContestEngine.RealContestSimulator.prototype._lastProblemIndex = function (state) {
    // 优先使用记录的最后做题索引，再回退到 currentProblem
    if (state.currentProblem >= 0 && state.currentProblem < this.config.problems.length) {
      return state.currentProblem;
    }
    if (typeof state.lastProblemIndex === 'number' && state.lastProblemIndex >= 0) {
      return Math.min(state.lastProblemIndex, this.config.problems.length - 1);
    }
    return 0;
  };

  /* ----- 日志查询 ----- */

  /**
   * 获取格式化的日志列表（供 UI 渲染使用）
   * @returns {Array} 格式化的日志条目 [{text, type}]
   */
  RealContestEngine.RealContestSimulator.prototype.getLog = function () {
    var result = [];
    for (var i = 0; i < this.log.length; i++) {
      var entry = this.log[i];
      var timeStr = '';
      if (typeof entry.time === 'number') {
        var mins = entry.time;
        var h = Math.floor(mins / 60);
        var m = mins % 60;
        timeStr = (h > 0 ? h + ':' : '') + (m < 10 ? '0' : '') + m;
      }
      result.push({
        text: '[' + timeStr + '] ' + (entry.message || ''),
        type: entry.type || 'info'
      });
    }
    return result;
  };

  /* ========================================================================
   * 第 9 节：比赛结果处理 — processContestResults
   * -----------------------------------------------------------------------
   * 比赛模拟结束后，由外部调用此函数进行后续处理：
   *   1. 根据 cutoffPercents 和省份类型计算晋级线
   *   2. 判断每个学生是否通过
   *   3. 返回结果汇总供 UI 使用
   *
   * 注意：声望更新、压力变化、生涯记录等由外部的 game.js 处理，
   * 此函数只负责计算晋级线并分类结果。
   * ======================================================================== */

  /**
   * 处理比赛结果
   * @param {Object} studentStates - 模拟器输出的学生状态映射 { name: state }
   * @param {Object} config - 比赛配置
   * @param {Object} contestDef - 比赛定义（REAL_CONTEST_SCHEDULE 条目）
   * @param {Object} game - 游戏状态对象
   * @returns {Object} 结果汇总 { results, passLine, totalMax, contestDef, medalResults }
   */
  RealContestEngine.processContestResults = function (studentStates, config, contestDef, game) {
    var results = [];

    // 收集所有分数用于排名
    var allScores = [];
    for (var name in studentStates) {
      if (!studentStates.hasOwnProperty(name)) continue;
      allScores.push(studentStates[name].finalScore || 0);
    }
    // 降序排列
    allScores.sort(function (a, b) { return b - a; });

    // 计算晋级线
    var provinceType = (game && game.provinceType) ? game.provinceType : '普通省';
    var cutoffPercent = 50;  // 默认 50%

    if (contestDef && contestDef.cutoffPercents) {
      cutoffPercent = contestDef.cutoffPercents[provinceType] || contestDef.cutoffPercents['普通省'] || 50;
    }

    var totalMax = config ? config.totalMaxScore : (contestDef ? contestDef.totalMaxScore : 400);
    var passLine = Math.floor(totalMax * cutoffPercent / 100);

    // 添加 ±5% 浮动
    var fluctuation = 1 + (Math.random() - 0.5) * 2 * PASS_LINE_FLUCTUATION;
    passLine = Math.floor(passLine * fluctuation);

    // 对每个学生生成结果
    for (var n in studentStates) {
      if (!studentStates.hasOwnProperty(n)) continue;
      var state = studentStates[n];
      var finalScore = state.finalScore || 0;
      var passed = finalScore >= passLine;

      // 奖牌判断（仅 NOI 级别比赛）
      var medal = null;
      if (contestDef && contestDef.id === 'NOI') {
        if (finalScore >= passLine) medal = 'gold';
        else if (finalScore >= passLine * 0.7) medal = 'silver';
        else if (finalScore >= passLine * 0.5) medal = 'bronze';
      }

      results.push({
        student: state.student,
        score: finalScore,
        rawScore: state.totalScore,
        maxScore: totalMax,
        passed: passed,
        medal: medal,
        problems: state.problems,
        // 计算排名
        rank: RealContestEngine._getRank(finalScore, allScores)
      });
    }

    // 按分数降序排列结果
    results.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return (a.student && a.student.name || '').localeCompare((b.student && b.student.name || ''));
    });

    // 计算奖牌统计
    var medalResults = {
      gold: 0,
      silver: 0,
      bronze: 0,
      passedCount: 0
    };
    for (var r = 0; r < results.length; r++) {
      if (results[r].passed) medalResults.passedCount++;
      if (results[r].medal === 'gold') medalResults.gold++;
      else if (results[r].medal === 'silver') medalResults.silver++;
      else if (results[r].medal === 'bronze') medalResults.bronze++;
    }

    return {
      results: results,
      passLine: passLine,
      totalMax: totalMax,
      contestDef: contestDef,
      medalResults: medalResults
    };
  };

  /**
   * 获取某个分数在降序排列数组中的排名
   * @param {number} score - 待查询的分数
   * @param {Array} sortedScores - 降序排列的分数数组
   * @returns {number} 排名（1-based）
   */
  RealContestEngine._getRank = function (score, sortedScores) {
    for (var i = 0; i < sortedScores.length; i++) {
      if (score >= sortedScores[i]) {
        return i + 1;
      }
    }
    return sortedScores.length;
  };

  /* ========================================================================
   * 第 10 节：赛后影响计算 — applyContestEffects
   * -----------------------------------------------------------------------
   * 比赛结束后对每个学生施加各种影响：
   *   1. 压力变化（通过 → 减压；未通过 → 加压）
   *   2. 心理变化（通过 → 加；未通过 → 减）
   *   3. 声望变化（根据比赛级别和奖牌）
   *   4. 触发 contest_finish 天赋事件
   * ======================================================================== */

  /**
   * 应用比赛后的影响
   * @param {Array} results - processContestResults 返回的 results 数组
   * @param {Object} contestDef - 比赛定义
   * @param {Object} passLine - 晋级线
   * @param {Object} game - 游戏状态对象
   * @returns {Object} { reputationGain, pressureChanges, talentEvents }
   */
  RealContestEngine.applyContestEffects = function (results, contestDef, passLine, game) {
    var reputationGain = 0;
    var pressureChanges = [];
    var talentEvents = [];

    // 全局压力增幅倍率
    var pressureMult = (typeof PRESSURE_INCREASE_MULTIPLIER !== 'undefined') ? PRESSURE_INCREASE_MULTIPLIER : 1.0;

    // 计算总分中点（用于判断是否"发挥不佳"）
    var totalMax = contestDef ? contestDef.totalMaxScore : 400;
    var baseline = totalMax / 2;

    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      if (!r || !r.student) continue;
      var s = r.student;
      var score = r.score || 0;

      // 触发 contest_finish 天赋
      if (typeof s.triggerTalents === 'function') {
        try {
          var finResults = s.triggerTalents('contest_finish', {
            contestName: contestDef ? contestDef.id : 'unknown',
            score: score,
            passed: r.passed,
            passLine: passLine
          });
          if (finResults && finResults.length) {
            for (var t = 0; t < finResults.length; t++) {
              if (finResults[t] && finResults[t].result) {
                talentEvents.push({
                  student: s.name,
                  message: finResults[t].result
                });
              }
            }
          }
        } catch (e) { /* ignore */ }
      }

      // 压力 / 心理变化
      if (r.passed) {
        s.pressure = Math.max(0, Number(s.pressure || 0) - 10);
        s.mental = Math.min(100, Number(s.mental || 0) + 3);
        pressureChanges.push({ student: s.name, change: -10, type: 'pass' });
      } else {
        var pressureAdd = Math.floor(15 * pressureMult);
        s.pressure = Math.min(100, Number(s.pressure || 0) + pressureAdd);
        s.mental = Math.max(0, Number(s.mental || 0) - 5);
        pressureChanges.push({ student: s.name, change: pressureAdd, type: 'fail' });
      }

      // 额外压力：发挥不佳
      if (!r.passed || score < baseline) {
        var scoreBelow = Math.max(0, baseline - score);
        var unit = Math.max(1, totalMax / 20);
        var extraPressure = Math.min(15, Math.ceil(scoreBelow / unit));
        if (extraPressure > 0) {
          var epApplied = Math.floor(extraPressure * 2 * pressureMult);
          s.pressure = Math.min(100, Number(s.pressure || 0) + epApplied);
          pressureChanges[pressureChanges.length - 1].extraPressure = epApplied;
        }
      }
    }

    // 声望计算
    var passedCount = 0;
    var goldCount = 0;
    var silverCount = 0;
    var bronzeCount = 0;

    for (var j = 0; j < results.length; j++) {
      if (results[j].passed) passedCount++;
      if (results[j].medal === 'gold') goldCount++;
      else if (results[j].medal === 'silver') silverCount++;
      else if (results[j].medal === 'bronze') bronzeCount++;
    }

    // 根据比赛级别计算声望
    if (contestDef && contestDef.rewards) {
      if (contestDef.rewards.pass) {
        reputationGain += (contestDef.rewards.pass.reputation || 0) * passedCount;
      }
      if (contestDef.rewards.gold) {
        reputationGain += (contestDef.rewards.gold.reputation || 0) * goldCount;
      }
      if (contestDef.rewards.silver) {
        reputationGain += (contestDef.rewards.silver.reputation || 0) * silverCount;
      }
      if (contestDef.rewards.bronze) {
        reputationGain += (contestDef.rewards.bronze.reputation || 0) * bronzeCount;
      }
    }

    // 应用声望
    if (reputationGain > 0 && game) {
      game.reputation = Math.min(100, (game.reputation || 0) + reputationGain);
    }

    // 比赛奖金（奖牌 → BudgetManager 金钱奖励）
    var totalPrize = 0;
    if (contestDef && contestDef.rewards) {
      // 金牌奖金
      var goldPrizeBase = contestDef.rewards.gold ? (contestDef.rewards.gold.prize || 0) : 0;
      if (goldPrizeBase > 0 && goldCount > 0) {
        totalPrize += Math.floor(goldPrizeBase * goldCount);
      }
      // 银牌奖金
      var silverPrizeBase = contestDef.rewards.silver ? (contestDef.rewards.silver.prize || 0) : 0;
      if (silverPrizeBase > 0 && silverCount > 0) {
        totalPrize += Math.floor(silverPrizeBase * silverCount);
      }
      // 铜牌奖金
      var bronzePrizeBase = contestDef.rewards.bronze ? (contestDef.rewards.bronze.prize || 0) : 0;
      if (bronzePrizeBase > 0 && bronzeCount > 0) {
        totalPrize += Math.floor(bronzePrizeBase * bronzeCount);
      }
      // 过线奖励（即使没拿奖牌）
      var passPrizeBase = contestDef.rewards.pass ? (contestDef.rewards.pass.prize || 0) : 0;
      if (passPrizeBase > 0 && passedCount > 0) {
        // 过线但没拿牌的学生也获得过线奖
        var passOnlyCount = passedCount - goldCount - silverCount - bronzeCount;
        if (passOnlyCount > 0) {
          totalPrize += Math.floor(passPrizeBase * passOnlyCount);
        }
      }
    }
    // 发放奖金到 BudgetManager
    if (totalPrize > 0 && typeof BudgetManager !== 'undefined' && typeof BudgetManager.receive === 'function') {
      var contestWeek = (game && typeof game.week === 'number') ? game.week : 0;
      var contestName = contestDef ? contestDef.name : '比赛';
      BudgetManager.receive(totalPrize, contestName + ' 奖金', contestWeek);
    }

    return {
      reputationGain: reputationGain,
      totalPrize: totalPrize,
      pressureChanges: pressureChanges,
      talentEvents: talentEvents
    };
  };

  /* ========================================================================
   * 第 11 节：比赛流程控制 — runContest
   * -----------------------------------------------------------------------
   * 便捷函数：从比赛定义到模拟完成的一站式流程。
   * 适用于外部代码（如 game.js 的事件处理器）直接调用。
   * ======================================================================== */

  /**
   * 运行一场完整的比赛模拟
   * @param {Object} contestDef - 比赛定义（REAL_CONTEST_SCHEDULE 中的条目）
   * @param {Array} students - 参赛学生数组
   * @param {Object} game - 游戏状态对象
   * @param {Function} onComplete - 完成回调 function(processedResults, effects)
   * @returns {Object} 模拟器实例（可用于 UI 显示实时进度）
   */
  RealContestEngine.runContest = function (contestDef, students, game, onComplete) {
    // 筛选活跃学生
    var activeStudents = [];
    for (var i = 0; i < students.length; i++) {
      if (students[i] && students[i].active !== false) {
        activeStudents.push(students[i]);
      }
    }

    if (activeStudents.length === 0) {
      console.warn('[RealContestEngine] 没有活跃学生可参赛');
      return null;
    }

    // 构建配置
    var config = RealContestEngine.buildContestConfig(contestDef, game ? game.week : 1);

    // 创建模拟器
    var simulator = new RealContestEngine.RealContestSimulator(config, activeStudents, game);

    // 注册完成回调
    simulator.onFinish = function (studentStates, cfg, log) {
      // 处理结果
      var processed = RealContestEngine.processContestResults(
        studentStates, cfg, contestDef, game
      );

      // 应用影响
      var effects = RealContestEngine.applyContestEffects(
        processed.results, contestDef, processed.passLine, game
      );

      // 调用完成回调
      if (typeof onComplete === 'function') {
        onComplete(processed, effects);
      }
    };

    // 启动模拟
    simulator.start();

    return simulator;
  };

  /* ========================================================================
   * 第 12 节：导出到全局
   * ======================================================================== */

  global.RealContestEngine = RealContestEngine;

  // 加载完成提示
  if (typeof console !== 'undefined') {
    console.log('[Real Mode] real-simulator.js 加载完成 — 比赛模拟引擎就绪');
  }

})(typeof window !== 'undefined' ? window : this);
