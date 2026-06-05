/* ==========================================================================
 * real-training.js — OItrainer「Real Mode」训练行动系统
 * --------------------------------------------------------------------------
 * 本文件负责处理 Real Mode 下学生每周可执行的训练行动：
 *   做题训练 / 高强度训练 / 集训 / 修习文化课 / 运动 / 休息 / 娱乐
 *
 * 依赖全局：
 *   window.Student          — 学生类（knowledge_ds/graph/string/math/dp 等）
 *   window.PersonalityManager — 性格系统（applyTrainingModifier / applyPressureModifier）
 *   window.BudgetManager      — 预算管理（spend）
 *   window.REAL_ACTIONS       — 行动定义（real-data.js）
 *   window.REAL_TASK_POOL     — 108 个训练任务池（real-data.js）
 *   window.RealCalendar       — 日历工具（real-data.js）
 *   window.getRandom          — 随机数生成（utils.js）
 *   window.game               — GameState 全局实例
 *
 * 风格约定：
 *   - ES5 语法（var / function），不使用 let/const、箭头函数、模板字符串
 *   - 所有全局挂载统一使用 window.* 前缀
 *   - 注释使用中文
 * ========================================================================== */

(function () {
  'use strict';

  window.RealTraining = {};

  /* ========================================================================
   * 常量
   * ======================================================================== */

  /** 训练强度倍率映射：intensity(1/2/3) → 知识增益倍率 */
  var INTENSITY_MULTIPLIERS = { 1: 1.0, 2: 1.5, 3: 2.5 };

  /** 默认训练强度 */
  var DEFAULT_INTENSITY = 1;

  /** 随机任务选择数量（默认） */
  var DEFAULT_TASK_COUNT = 6;

  /** 体力等级阈值及其对应的训练效率倍率 */
  var STAMINA_TIERS = [
    { threshold: 60, multiplier: 1.0 },
    { threshold: 30, multiplier: 0.8 }
  ];
  /** 低于所有阈值的兜底倍率 */
  var STAMINA_FLOOR_MULTIPLIER = 0.6;

  /** 知识点中文名列表，用于遍历和批量操作 */
  var KNOWLEDGE_AREAS = ['数据结构', '图论', '字符串', '数学', 'DP'];

  /* ========================================================================
   * 工具函数（内部使用）
   * ======================================================================== */

  /**
   * 获取安全引用：如果全局可用则使用全局对象，否则返回 undefined。
   * 避免在模块加载顺序不确定时直接访问 window.xxx 导致 ReferenceError。
   */
  function _getPersonalityManager() {
    return window.PersonalityManager || undefined;
  }

  function _getBudgetManager() {
    return window.BudgetManager || undefined;
  }

  function _getGame() {
    // 优先使用真实模式的游戏状态
    if (window.RealGame && window.RealGame.state) return window.RealGame.state;
    return window.game || undefined;
  }

  /**
   * 随机数 [0, 1)，优先使用全局 getRandom，回退到 Math.random
   * @returns {number}
   */
  function _rand() {
    if (typeof window.getRandom === 'function') {
      return window.getRandom();
    }
    return Math.random();
  }

  /**
   * 根据体力值返回训练效率倍率
   * 体力 ≥60 → 1.0，≥30 → 0.8，<30 → 0.6
   * @param {number} stamina - 当前体力值
   * @returns {number} 效率倍率 (0.6 ~ 1.0)
   */
  function _getStaminaEfficiency(stamina) {
    var st = Number(stamina) || 0;
    for (var i = 0; i < STAMINA_TIERS.length; i++) {
      if (st >= STAMINA_TIERS[i].threshold) {
        return STAMINA_TIERS[i].multiplier;
      }
    }
    return STAMINA_FLOOR_MULTIPLIER;
  }

  /**
   * 获取设施加成倍率（图书馆效率等）
   * @returns {number} 设施加成倍率，默认 1.0
   */
  function _getFacilityMultiplier() {
    var g = _getGame();
    if (g && g.facilities && typeof g.facilities.getLibraryEfficiency === 'function') {
      var eff = g.facilities.getLibraryEfficiency();
      return (typeof eff === 'number' && isFinite(eff)) ? eff : 1.0;
    }
    return 1.0;
  }

  /**
   * 获取电脑设施加成倍率（思维/编码训练效率）
   * @returns {number} 电脑加成倍率，默认 1.0
   */
  function _getComputerMultiplier() {
    var g = _getGame();
    if (g && g.facilities && typeof g.facilities.getComputerEfficiency === 'function') {
      var eff = g.facilities.getComputerEfficiency();
      return (typeof eff === 'number' && isFinite(eff)) ? eff : 1.0;
    }
    return 1.0;
  }

  /**
   * 获取食堂压力减免系数
   * @returns {number} 压力减免系数（< 1.0 表示减少），默认 1.0（无减免）
   */
  function _getCanteenPressureMultiplier() {
    var g = _getGame();
    if (g && g.facilities && typeof g.facilities.getCanteenPressureReduction === 'function') {
      var eff = g.facilities.getCanteenPressureReduction();
      return (typeof eff === 'number' && isFinite(eff)) ? eff : 1.0;
    }
    return 1.0;
  }

  /**
   * 安全地将数值限制在 [min, max] 范围内
   * @param {number} value
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  function _clamp(value, min, max) {
    if (typeof window.clamp === 'function') {
      return window.clamp(value, min, max);
    }
    var v = Number(value) || 0;
    return v < min ? min : (v > max ? max : v);
  }

  /* ========================================================================
   * 训练主函数
   * ======================================================================== */

  /**
   * 执行训练行动（总入口）
   *
   * @param {string} actionName  - 行动名称（做题训练 / 高强度训练 / 集训 / 修习文化课 / 运动 / 休息 / 娱乐）
   * @param {Student[]} selectedStudents - 参与的学生数组
   * @param {Object}   options - 附加选项
   *   options.task            - 选中的任务对象（用于做题训练 / 高强度训练）
   *   options.difficultyRange - 难度筛选范围 [min, max]
   *   options.knowledgeType    - 知识点筛选（中文名）
   *   options.intensity       - 训练强度 1 / 2 / 3
   * @returns {Object} {success: Boolean, events: Array, summary: String}
   */
  RealTraining.executeAction = function (actionName, selectedStudents, options) {
    options = options || {};

    // ---------- 参数校验 ----------
    if (!actionName || !window.REAL_ACTIONS) {
      return { success: false, events: [], summary: '未知行动' };
    }

    var action = window.REAL_ACTIONS[actionName];
    if (!action) {
      return { success: false, events: [], summary: '未知行动: ' + actionName };
    }

    if (!selectedStudents || !Array.isArray(selectedStudents) || selectedStudents.length === 0) {
      return { success: false, events: [], summary: '未选择学生' };
    }

    var week = (window.game && typeof window.game.week === 'number') ? window.game.week : 1;

    // ---------- 根据 action.type 分派到对应的处理函数 ----------
    switch (action.type) {
      case 'training':
        return RealTraining._doTraining(actionName, action, selectedStudents, options, week);
      case 'camp':
        return RealTraining._doCamp(actionName, action, selectedStudents, options, week);
      case 'academic':
        return RealTraining._doAcademic(actionName, action, selectedStudents, options, week);
      case 'exercise':
        return RealTraining._doExercise(actionName, action, selectedStudents, options, week);
      case 'rest':
        return RealTraining._doRest(actionName, action, selectedStudents, options, week);
      case 'entertainment':
        return RealTraining._doEntertainment(actionName, action, selectedStudents, options, week);
      case 'outing':
        return RealTraining._doOuting(actionName, action, selectedStudents, options, week);
      default:
        return { success: false, events: [], summary: '未知行动类型: ' + action.type };
    }
  };

  /* ========================================================================
   * 做题训练 / 高强度训练
   * -----------------------------------------------------------------------
   * 两种行动共享同一个处理函数，通过 actionName 区分：
   *   - 「做题训练」：免费，基础消耗，标准增益
   *   - 「高强度训练」：消耗经费 ¥500，体力/压力消耗翻倍，知识增益更多
   * ======================================================================== */

  /**
   * 处理做题训练和高强度训练
   *
   * @param {string}     actionName - 行动名称
   * @param {Object}     action     - REAL_ACTIONS 中对应的行动定义
   * @param {Student[]}  students   - 参与学生数组
   * @param {Object}     options    - 选项（含 task, intensity）
   * @param {number}     week       - 当前周数
   * @returns {Object} {success, events, summary}
   */
  RealTraining._doTraining = function (actionName, action, students, options, week) {
    var events = [];
    var task = options.task || null;
    var intensity = options.intensity || DEFAULT_INTENSITY;

    // 是否为高强度训练
    var isHighIntensity = (actionName === '高强度训练');

    // ---------- 校验：必须选择任务 ----------
    if (!task) {
      return { success: false, events: [], summary: '请选择训练题目' };
    }

    // ---------- 高强度训练：扣除经费 ----------
    if (isHighIntensity) {
      var bm = _getBudgetManager();
      if (bm) {
        bm.spend(action.cost, actionName, week);
      }
    }

    // ---------- 获取全局修正系数（所有学生共用） ----------
    var intensityMult = INTENSITY_MULTIPLIERS[intensity] || INTENSITY_MULTIPLIERS[DEFAULT_INTENSITY];
    var facilityMult = _getFacilityMultiplier();        // 图书馆：知识增益
    var computerMult = _getComputerMultiplier();        // 电脑：思维/编码增益
    var canteenMult = _getCanteenPressureMultiplier(); // 食堂：压力减免

    // ---------- 逐个学生处理 ----------
    for (var i = 0; i < students.length; i++) {
      var s = students[i];

      // --- 体力检查 ---
      var staminaCost = action.staminaCost || 10;
      // 高强度训练额外增加体力消耗
      if (isHighIntensity) {
        staminaCost = Math.floor(staminaCost * 1.5);
      }

      if (s.stamina < staminaCost * 0.5) {
        events.push({
          type: 'warning',
          student: s.name,
          message: s.name + ' 体力不足（' + s.stamina + '/' + staminaCost + '），训练效率大幅降低'
        });
      }

      // --- 计算体力效率（在扣减体力之前计算） ---
      var staminaMod = _getStaminaEfficiency(s.stamina);

      // --- 扣减体力 ---
      s.stamina = Math.max(0, s.stamina - Math.floor(staminaCost * staminaMod));

      // --- 从任务 boosts 中获取知识增益 ---
      var knowledgeGains = {};
      var totalKnowledgeGain = 0;

      for (var b = 0; b < task.boosts.length; b++) {
        var boost = task.boosts[b];
        var baseAmount = boost.amount || 0;

        // 训练强度倍率
        baseAmount = baseAmount * intensityMult;

        // 高强度训练额外知识增益 ×1.5
        if (isHighIntensity) {
          baseAmount = baseAmount * 1.5;
        }

        // 性格修正（知识增益乘数、自虐狂动态倍率等）
        var pm = _getPersonalityManager();
        if (pm) {
          baseAmount = pm.applyTrainingModifier(s, baseAmount, s.pressure);
        }

        // 体力修正（低体力 = 效率降低）
        baseAmount = baseAmount * staminaMod;

        // 设施加成（图书馆效率等）
        baseAmount = baseAmount * facilityMult;

        // 取整并应用知识增益
        var actualAmount = Math.max(0, Math.floor(baseAmount));
        if (actualAmount > 0) {
          s.addKnowledge(boost.type, actualAmount);
        }
        knowledgeGains[boost.type] = actualAmount;
        totalKnowledgeGain += actualAmount;
      }

      // --- 思维 / 编码能力增益 ---
      // 基础增益随训练强度和任务难度增加，受电脑设施加成
      // 高强度训练额外能力增益倍率
      var abilityMult = isHighIntensity ? 1.5 : 1.0;

      var diffBonus = Math.min(2.0, task.difficulty / 50.0);  // 难度越高增益越大
      var thinkingGain = Math.max(0,
        Math.floor((1.5 + _rand() * 1.5) * intensity * diffBonus * staminaMod * computerMult * facilityMult * abilityMult)
      );
      var codingGain = Math.max(0,
        Math.floor((1.2 + _rand() * 1.2) * intensity * diffBonus * staminaMod * computerMult * facilityMult * abilityMult)
      );

      if (thinkingGain > 0) { s.addThinking(thinkingGain); }
      if (codingGain > 0) { s.addCoding(codingGain); }

      // --- 压力变化 ---
      var basePressure = (action.pressureChange || 0) * intensity;
      // 高强度训练额外压力
      if (isHighIntensity) {
        basePressure = Math.floor(basePressure * 1.3);
      }

      // 性格修正（稳健型减压、夜猫子加压等）
      if (pm) {
        basePressure = pm.applyPressureModifier(s, basePressure);
      }

      // 食堂压力减免
      basePressure = Math.floor(basePressure * canteenMult);

      // 应用压力变化（限制在 [0, 100]）
      s.pressure = _clamp(s.pressure + basePressure, 0, 100);

      // --- 天赋触发：压力变化事件 ---
      if (basePressure > 0 && typeof s.triggerTalents === 'function') {
        var talentResults = s.triggerTalents('pressure_change', {
          amount: basePressure,
          intensity: intensity,
          source: actionName
        });
        // 处理天赋返回的特殊 action（如抗压奇才的 halve_pressure）
        if (talentResults && talentResults.length) {
          for (var tr = 0; tr < talentResults.length; tr++) {
            var trRes = talentResults[tr];
            if (trRes && trRes.result && typeof trRes.result === 'object' && trRes.result.action === 'halve_pressure') {
              // 抗压奇才：将本次压力增幅减半（修正已应用的值）
              var halveAmount = Math.floor(basePressure / 2);
              s.pressure = _clamp(s.pressure - halveAmount, 0, 100);
              events.push({
                type: 'talent',
                student: s.name,
                message: s.name + ' 「抗压奇才」触发，压力增幅减半（-' + halveAmount + '）'
              });
            }
          }
        }
      }

      // --- 记录事件 ---
      events.push({
        type: 'training',
        student: s.name,
        taskName: task.name,
        isHighIntensity: isHighIntensity,
        knowledge: knowledgeGains,
        totalKnowledgeGain: totalKnowledgeGain,
        thinkingGain: thinkingGain,
        codingGain: codingGain,
        pressureChange: basePressure,
        staminaCost: Math.floor(staminaCost * staminaMod),
        intensity: intensity
      });
    }

    // ---------- 生成总结 ----------
    var summary = students.length + ' 名学生完成了' + actionName +
      (task ? '（' + task.name + '）' : '');

    return { success: true, events: events, summary: summary };
  };

  /* ========================================================================
   * 集训
   * -----------------------------------------------------------------------
   * 集训覆盖所有 5 大知识点，知识增益量大，但体力消耗和压力增加较高。
   * 消耗经费 ¥1000。
   * ======================================================================== */

  /**
   * 处理集训行动
   *
   * @param {string}     actionName - 行动名称
   * @param {Object}     action     - 行动定义
   * @param {Student[]}  students   - 参与学生数组
   * @param {Object}     options    - 选项
   * @param {number}     week       - 当前周数
   * @returns {Object} {success, events, summary}
   */
  RealTraining._doCamp = function (actionName, action, students, options, week) {
    var events = [];
    var pm = _getPersonalityManager();

    // ---------- 扣除经费：每名学生 ¥1000 ----------
    var bm = _getBudgetManager();
    if (bm) {
      var campCostPerPerson = 1000;
      var totalCampCost = campCostPerPerson * students.length;
      bm.spend(totalCampCost, actionName, week);
    }

    // ---------- 逐个学生处理 ----------
    for (var i = 0; i < students.length; i++) {
      var s = students[i];

      // --- 体力检查（集训非常消耗体力） ---
      if (s.stamina < 20) {
        // 体力极低：无法参加集训
        events.push({
          type: 'warning',
          student: s.name,
          message: s.name + ' 体力不足（' + s.stamina + '），无法参加集训'
        });
        continue; // 跳过该学生
      }

      // --- 体力偏低：效果减半 + 额外压力 ---
      var isLowStamina = (s.stamina < 40);
      if (isLowStamina) {
        events.push({
          type: 'warning',
          student: s.name,
          message: s.name + ' 体力偏低（' + s.stamina + '），集训效果减半'
        });
        s.pressure = _clamp(s.pressure + 10, 0, 100);
      }

      // --- 扣减体力（集训消耗大） ---
      var staminaCost = action.staminaCost || 25;
      s.stamina = Math.max(0, s.stamina - staminaCost);

      // --- 知识增益（集训覆盖全部 5 大知识点） ---
      var gains = {};
      for (var a = 0; a < KNOWLEDGE_AREAS.length; a++) {
        var areaName = KNOWLEDGE_AREAS[a];
        var baseGain = 3 + _rand() * 5; // 3~8

        // 体力偏低时效果减半
        if (isLowStamina) {
          baseGain = baseGain * 0.5;
        }

        // 性格修正
        if (pm) {
          baseGain = pm.applyTrainingModifier(s, baseGain, s.pressure);
        }

        var actualGain = Math.max(0, Math.floor(baseGain));
        if (actualGain > 0) {
          s.addKnowledge(areaName, actualGain);
        }
        gains[areaName] = actualGain;
      }

      // --- 思维 / 编码能力增益（中等量） ---
      var thinkingGain = Math.max(0, Math.floor(1 + _rand() * 2));
      var codingGain = Math.max(0, Math.floor(1 + _rand() * 2));
      s.addThinking(thinkingGain);
      s.addCoding(codingGain);

      // --- 压力变化 ---
      var pressChange = action.pressureChange || 8;
      if (pm) {
        pressChange = pm.applyPressureModifier(s, pressChange);
      }
      s.pressure = _clamp(s.pressure + pressChange, 0, 100);

      // --- 记录事件 ---
      events.push({
        type: 'camp',
        student: s.name,
        knowledge: gains,
        thinkingGain: thinkingGain,
        codingGain: codingGain,
        pressureChange: pressChange,
        staminaCost: staminaCost,
        isLowStamina: isLowStamina
      });
    }

    // ---------- 生成总结 ----------
    var summary = students.length + ' 名学生完成了集训';

    return { success: true, events: events, summary: summary };
  };

  /* ========================================================================
   * 研学
   * -----------------------------------------------------------------------
   * 完整版研学：选省份、选难度、选学生、可选天赋激发。
   * 费用动态计算（难度 × 省份 × 人数 × 声誉折扣）。
   * 知识增益基于难度 × 省份训练质量。
   * 能力不匹配时增益大幅降低、压力加倍。
   * 天赋激发：每个 ¥12,000，30% 概率获得选中天赋。
   * ======================================================================== */

  /**
   * 省份坐标表（标准化 0~100，x=东西，y=南北）
   * 基于中国实际地理位置粗略标注，用于欧几里得距离计算
   */
  var PROVINCE_COORDS = {
    1:  [65, 35],  // 北京
    2:  [45, 60],  // 重庆
    3:  [50, 62],  // 湖南
    4:  [50, 82],  // 广东
    5:  [32, 55],  // 四川
    6:  [72, 58],  // 浙江
    7:  [75, 52],  // 上海
    8:  [68, 68],  // 福建
    9:  [70, 50],  // 江苏
    10: [68, 38],  // 山东
    11: [52, 55],  // 湖北
    12: [62, 65],  // 江西
    13: [63, 32],  // 河北
    14: [55, 85],  // 香港
    15: [48, 42],  // 陕西
    16: [55, 45],  // 河南
    17: [65, 55],  // 安徽
    18: [80, 10],  // 黑龙江
    19: [42, 78],  // 广西
    20: [75, 22],  // 辽宁
    21: [80, 17],  // 吉林
    22: [67, 35],  // 天津
    23: [55, 38],  // 山西
    24: [40, 65],  // 贵州
    25: [52, 85],  // 澳门
    26: [12, 25],  // 新疆
    27: [48, 90],  // 海南
    28: [55, 18],  // 内蒙古（中部）
    29: [30, 68],  // 云南
    30: [42, 35],  // 宁夏
    31: [38, 36],  // 甘肃
    32: [28, 38],  // 青海
    33: [15, 45]   // 西藏
  };

  /**
   * 距离→费用倍率阶梯表
   */
  var DIST_TIERS = [
    { max: 15, mult: 1.0 },   // 紧邻（如甘肃→陕西、广东→广西）
    { max: 25, mult: 1.2 },   // 邻近（如青海→新疆）
    { max: 42, mult: 1.4 },   // 较远（如上海→广东）
    { max: 58, mult: 1.6 },   // 很远（如广东→北京）
    { max: 999, mult: 1.8 }   // 极远（如广东→黑龙江、上海→新疆）
  ];

  /**
   * 计算研学目的地与玩家所在省份之间的路程距离倍率
   *
   * 基于省份坐标的欧几里得距离，映射到 5 级费用倍率：
   *   - 1.0x  距离 < 15  （紧邻/同城）
   *   - 1.2x  距离 < 25  （邻近区域）
   *   - 1.4x  距离 < 42  （较远）
   *   - 1.6x  距离 < 58  （很远）
   *   - 1.8x  距离 >= 58 （极远）
   *
   * @param {number} targetProvinceIdx - 目的地省份在 PROVINCES 中的 key
   * @returns {number} 距离费用倍率
   */
  RealTraining._getTravelDistanceMultiplier = function (targetProvinceIdx) {
    var state = (window.RealGame && window.RealGame.state) ? window.RealGame.state : null;
    if (!state) return 1.2;

    var provinces = (typeof PROVINCES !== 'undefined') ? PROVINCES : null;
    if (!provinces) return 1.2;

    var currentKey = Object.keys(provinces)[state.provinceIndex || 0];

    // 同省份
    if (currentKey == targetProvinceIdx) return 1.0;

    var c1 = PROVINCE_COORDS[currentKey];
    var c2 = PROVINCE_COORDS[targetProvinceIdx];
    if (!c1 || !c2) return 1.2;

    var dx = c1[0] - c2[0];
    var dy = c1[1] - c2[1];
    var dist = Math.sqrt(dx * dx + dy * dy);

    for (var i = 0; i < DIST_TIERS.length; i++) {
      if (dist < DIST_TIERS[i].max) return DIST_TIERS[i].mult;
    }
    return 1.8;
  };

  /**
   * 计算研学费用
   * @param {number} difficulty - 难度 (1=基础, 2=提高, 3=冲刺)
   * @param {number} provinceIdx - 省份索引
   * @param {number} studentCount - 参加人数
   * @param {number} reputation - 当前声誉
   * @returns {number} 总费用
   */
  RealTraining.computeOutingCost = function (difficulty, provinceIdx, studentCount, reputation) {
    var OUTFIT_BASE_COST = { 1: 17000, 2: 25000, 3: 70000 };
    var STRONG_MULT = 1.5;
    var WEAK_MULT = 0.7;
    var DIFF_PENALTY = { 1: 100, 2: 300, 3: 600 };

    var provinces = (typeof PROVINCES !== 'undefined') ? PROVINCES : null;
    var target = provinces ? provinces[provinceIdx] : null;
    var provType = (target && target.type) ? target.type : '普通省';

    var base = OUTFIT_BASE_COST[difficulty] || OUTFIT_BASE_COST[1];
    if (provType === '强省') {
      base = Math.floor(base * STRONG_MULT);
    } else if (provType === '弱省') {
      base = Math.floor(base * WEAK_MULT);
    }

    var n = Math.max(0, Number(studentCount || 0));
    var diffPenalty = DIFF_PENALTY[difficulty] || 100;

    // 路程距离倍率（同省 1.0x，同区域 1.2x，跨区域 1.5x，边疆 1.8x）
    var travelMult = RealTraining._getTravelDistanceMultiplier(provinceIdx);

    var raw = Math.max(0, Math.floor((base + 18000 * n + diffPenalty) * travelMult));

    // 声誉折扣（最多 50%）
    var rep = (typeof reputation === 'number') ? Math.max(0, Math.min(100, reputation)) : 0;
    var discount = Math.min(0.50, (rep / 100.0) * 0.60 * 2.0);
    return Math.max(0, Math.floor(raw * (1.0 - discount)));
  };

  /**
   * 处理研学行动（完整版，移植自简化模式）
   *
   * options 字段:
   *   difficulty    {number} 难度 (1=基础, 2=提高, 3=冲刺)
   *   provinceIdx   {number} 省份在 PROVINCES 中的索引
   *   inspireTalents {Array} 要激发的天赋名称列表
   *
   * @param {string}     actionName - 行动名称
   * @param {Object}     action     - 行动定义
   * @param {Student[]}  students   - 参与学生数组
   * @param {Object}     options    - 选项
   * @param {number}     week       - 当前周数
   * @returns {Object} {success, events, summary, totalCost}
   */
  RealTraining._doOuting = function (actionName, action, students, options, week) {
    options = options || {};
    var events = [];
    var pm = _getPersonalityManager();
    var bm = _getBudgetManager();

    var difficulty  = options.difficulty || 1;
    var provinceIdx = options.provinceIdx || 1;
    var inspireTalents = options.inspireTalents || [];

    // ---------- 省份信息 ----------
    var provinces = (typeof PROVINCES !== 'undefined') ? PROVINCES : null;
    var target = provinces ? provinces[provinceIdx] : { name: '未知', type: '普通省', trainingQuality: 1.0 };
    var provName = target.name || '未知';
    var trainingQuality = target.trainingQuality || 1.0;

    // ---------- 难度参数 ----------
    var OUTFIT_KB = { 1: 15, 2: 30, 3: 50 };        // 知识基础值
    var OUTFIT_AB = { 1: 18.0, 2: 35.0, 3: 55.0 };  // 能力基础值
    var OUTFIT_PR = { 1: 12, 2: 22, 3: 35 };         // 压力基础值

    var knowledge_base = OUTFIT_KB[difficulty] || OUTFIT_KB[1];
    var ability_base   = OUTFIT_AB[difficulty] || OUTFIT_AB[1];
    var pressure_base   = OUTFIT_PR[difficulty] || OUTFIT_PR[1];

    // ---------- 费用计算 ----------
    var reputation = (window.RealGame && window.RealGame.state)
      ? (window.RealGame.state.reputation || 0) : 0;
    var baseCost = RealTraining.computeOutingCost(difficulty, provinceIdx, students.length, reputation);
    var talentInspireCost = inspireTalents.length * 12000;
    var totalCost = baseCost + talentInspireCost;

    // ---------- 天赋费用减免（省钱大师等） ----------
    try {
      var totalReduction = 0;
      var reductionDetails = [];
      for (var ri = 0; ri < students.length; ri++) {
        var rs = students[ri];
        try {
          var rResults = null;
          if (rs && typeof rs.triggerTalents === 'function') {
            rResults = rs.triggerTalents('outing_cost_calculate', {
              province: provName,
              difficulty: difficulty,
              participantCount: students.length
            });
          }
          if (rResults && rResults.length) {
            for (var rr = 0; rr < rResults.length; rr++) {
              var rRes = rResults[rr];
              var rAction = (rRes && rRes.result) ? rRes.result : rRes;
              if (rAction && rAction.action === 'reduce_outing_cost' && typeof rAction.amount === 'number') {
                totalReduction += Number(rAction.amount) || 0;
                reductionDetails.push({ student: rs.name, amount: Number(rAction.amount), message: rAction.message });
              }
            }
          }
        } catch (re) { /* 忽略单个学生天赋检查错误 */ }
      }
      if (totalReduction > 0) {
        var applied = Math.min(totalCost, Math.floor(totalReduction));
        totalCost = Math.max(0, totalCost - applied);
        events.push({
          type: 'talent',
          student: '省钱大师',
          message: '研学经费减免：共 -¥' + applied + '（明细: ' +
            reductionDetails.map(function(d) { return d.student + ':¥' + d.amount; }).join(', ') + '）'
        });
      }
    } catch (e) { /* 忽略天赋费用减免错误 */ }

    // ---------- 经费检查 ----------
    if (bm) {
      var currentBudget = bm.funds || 0;
      if (currentBudget < totalCost) {
        return { success: false, events: [], summary: '经费不足，无法研学！需要 ¥' + totalCost + '，当前余额 ¥' + currentBudget };
      }
    }

    // ---------- 扣费 ----------
    if (bm) {
      bm.spend(totalCost, '研学：' + provName, week);
    }

    // ---------- 逐个学生处理 ----------
    for (var i = 0; i < students.length; i++) {
      var s = students[i];

      // --- 体力检查 ---
      if (s.stamina < 20) {
        events.push({
          type: 'warning',
          student: s.name,
          message: s.name + ' 体力不足（' + s.stamina + '），无法参加研学'
        });
        continue;
      }

      // --- 体力偏低：效果减半 + 额外压力 ---
      var isLowStamina = (s.stamina < 40);
      var staminaMod = isLowStamina ? 0.5 : 1.0;

      // --- 扣减体力 ---
      var staminaCost = action.staminaCost || 25;
      s.stamina = Math.max(0, s.stamina - staminaCost);

      // --- 能力匹配检测（简化：用能力+知识均值代替 hiddenMockScore） ---
      var abilityAvg = s.getAbilityAvg ? s.getAbilityAvg() : ((s.thinking || 0) + (s.coding || 0)) / 2;
      var totalK = 0;
      for (var ka = 0; ka < KNOWLEDGE_AREAS.length; ka++) {
        totalK += (s.getKnowledge ? s.getKnowledge(KNOWLEDGE_AREAS[ka]) : 0);
      }
      var avgK = KNOWLEDGE_AREAS.length > 0 ? totalK / KNOWLEDGE_AREAS.length : 0;
      // scoreProxy 综合了能力（权重高）和知识（权重低），符合研学对综合实力的评估
      var scoreProxy = abilityAvg * 2.0 + avgK * 1.0;

      // 不匹配阈值：基础班 30, 提高班 80, 冲刺班 160
      // 阈值根据游戏初始学生属性范围校准：
      //   初始 abilityAvg ≈ 30~55, avgK ≈ 0 → scoreProxy ≈ 60~110
      //   基础班应允许大多数学生参加，提高班需一定基础，冲刺班需较强实力
      var mismatchThresholds = { 1: 30, 2: 80, 3: 160 };
      var scoreThreshold = mismatchThresholds[difficulty] || 30;
      var mismatch = (scoreProxy < scoreThreshold);

      // --- 知识增益 ---
      var knowledgeMult = trainingQuality;
      var knowledgeMod = mismatch ? 0.4 : 1.0;
      var gains = {};
      for (var a = 0; a < KNOWLEDGE_AREAS.length; a++) {
        var areaName = KNOWLEDGE_AREAS[a];
        var kMin = Math.floor(knowledge_base * knowledgeMult);
        var kMax = Math.floor(knowledge_base * knowledgeMult * 1.8);
        var kGain = Math.floor((kMin + _rand() * (kMax - kMin + 1)) * knowledgeMod * staminaMod);

        // 性格修正
        if (pm) {
          kGain = Math.max(0, Math.floor(pm.applyTrainingModifier(s, kGain, s.pressure)));
        }

        kGain = Math.max(0, kGain);
        if (kGain > 0 && s.addKnowledge) {
          s.addKnowledge(areaName, kGain);
        }
        gains[areaName] = kGain;
      }

      // --- 能力增益 ---
      var abilityMod = mismatch ? 0.7 : 1.0;
      var aMin = ability_base * trainingQuality;
      var aMax = ability_base * trainingQuality * 2.0;
      var thinkingGain = (aMin + _rand() * (aMax - aMin)) * abilityMod * staminaMod;
      var codingGain = (aMin + _rand() * (aMax - aMin)) * abilityMod * staminaMod;

      if (s.addThinking) s.addThinking(thinkingGain);
      if (s.addCoding)   s.addCoding(codingGain);

      // --- 压力变化 ---
      var pressureMult = mismatch ? 1.5 : 1.0;
      var pressChange = Math.floor(pressure_base * pressureMult * staminaMod);
      if (pm) {
        pressChange = pm.applyPressureModifier(s, pressChange);
      }
      s.pressure = _clamp(s.pressure + pressChange, 0, 100);

      // --- 触发天赋事件 ---
      if (s.triggerTalents) {
        try {
          s.triggerTalents('pressure_change', { source: 'outing', amount: pressChange, province: provName, difficulty: difficulty });
          s.triggerTalents('outing_finished', { province: provName, difficulty: difficulty, knowledge_gain: gains });
        } catch (e) { /* 忽略天赋错误 */ }
      }

      // --- 尝试获取天赋（常规概率） ---
      if (typeof TalentManager !== 'undefined' && TalentManager && typeof TalentManager.tryAcquireTalent === 'function') {
        try {
          var acquiredTalent = TalentManager.tryAcquireTalent(s, 1.0);
          if (acquiredTalent) {
            events.push({
              type: 'talent',
              message: s.name + ' 在研学中获得了天赋【' + acquiredTalent + '】（常规概率获得）'
            });
          }
        } catch (e) { /* 忽略 */ }
      }

      // --- 天赋激发（付费激发，30% 概率） ---
      for (var t = 0; t < inspireTalents.length; t++) {
        var tName = inspireTalents[t];
        if (Math.random() < 0.3) {
          if (s.talents && typeof s.talents.has === 'function' && !s.talents.has(tName)) {
            s.talents.add(tName);
            events.push({
              type: 'talent',
              message: s.name + ' 成功激发了天赋【' + tName + '】（天赋激发）'
            });
          }
        }
      }

      // --- 不匹配提示 ---
      if (mismatch) {
        events.push({
          type: 'mismatch',
          student: s.name,
          message: s.name + ' 实力与研学难度不匹配，压力增加，收获减少'
        });
      }

      // --- 记录事件 ---
      events.push({
        type: 'outing',
        student: s.name,
        knowledge: gains,
        thinkingGain: Math.round(thinkingGain * 10) / 10,
        codingGain: Math.round(codingGain * 10) / 10,
        pressureChange: pressChange,
        staminaCost: staminaCost,
        mismatch: mismatch
      });
    }

    // ---------- 生成总结 ----------
    var diffNames = { 1: '基础班', 2: '提高班', 3: '冲刺班' };
    var diffName = diffNames[difficulty] || '基础班';
    var summary = students.length + ' 名学生前往' + provName + '参加' + diffName + '研学（费用 ¥' + totalCost + '）';

    return { success: true, events: events, summary: summary, totalCost: totalCost };
  };

  /* ========================================================================
   * 修习文化课
   * -----------------------------------------------------------------------
   * 不消耗体力，轻微降低压力，提升文化课成绩。
   * ======================================================================== */

  /**
   * 处理修习文化课行动
   *
   * @param {string}     actionName - 行动名称
   * @param {Object}     action     - 行动定义
   * @param {Student[]}  students   - 参与学生数组
   * @param {Object}     options    - 选项
   * @param {number}     week       - 当前周数
   * @returns {Object} {success, events, summary}
   */
  RealTraining._doAcademic = function (actionName, action, students, options, week) {
    var events = [];

    for (var i = 0; i < students.length; i++) {
      var s = students[i];

      // --- 文化课成绩增益 ---
      var baseGain = action.academicGain || 8;
      // 小幅随机波动 ±20%
      var gain = Math.max(0, Math.floor(baseGain * (0.8 + _rand() * 0.4)));

      // 应用成绩（上限 100）
      s.academicScore = Math.min(100, (s.academicScore || 50) + gain);

      // --- 轻微降低压力 ---
      var pressureChange = -3;
      s.pressure = Math.max(0, s.pressure + pressureChange);

      // --- 记录事件 ---
      events.push({
        type: 'academic',
        student: s.name,
        academicGain: gain,
        newAcademicScore: s.academicScore,
        pressureChange: pressureChange
      });
    }

    var summary = students.length + ' 名学生修习了文化课';
    return { success: true, events: events, summary: summary };
  };

  /* ========================================================================
   * 运动
   * -----------------------------------------------------------------------
   * 运动可有效缓解压力，但消耗少量体力。
   * 效果与当前体力有关：
   *   - 体力充沛（≥70）：大幅减压 -20，消耗 10 体力
   *   - 体力正常（≥40）：适度减压 -10，消耗 5 体力
   *   - 体力不足（<40）：反而增压 +5，消耗 5 体力
   * ======================================================================== */

  /**
   * 处理运动行动
   *
   * @param {string}     actionName - 行动名称
   * @param {Object}     action     - 行动定义
   * @param {Student[]}  students   - 参与学生数组
   * @param {Object}     options    - 选项
   * @param {number}     week       - 当前周数
   * @returns {Object} {success, events, summary}
   */
  RealTraining._doExercise = function (actionName, action, students, options, week) {
    var events = [];

    for (var i = 0; i < students.length; i++) {
      var s = students[i];

      var pressureChange;
      var staminaCost;

      if (s.stamina >= 70) {
        // 体力充沛 — 大幅减压
        pressureChange = -20;
        staminaCost = 10;
      } else if (s.stamina >= 40) {
        // 体力正常 — 适度减压
        pressureChange = -10;
        staminaCost = 5;
      } else {
        // 体力不足 — 反而增压（运动反而造成负担）
        pressureChange = 5;
        staminaCost = 5;
      }

      // 应用压力与体力变化
      s.pressure = _clamp(s.pressure + pressureChange, 0, 100);
      s.stamina = Math.max(0, s.stamina - staminaCost);

      // --- 记录事件 ---
      events.push({
        type: 'exercise',
        student: s.name,
        pressureChange: pressureChange,
        staminaCost: staminaCost,
        staminaBefore: s.stamina + staminaCost
      });
    }

    var summary = students.length + ' 名学生进行了运动';
    return { success: true, events: events, summary: summary };
  };

  /* ========================================================================
   * 休息
   * -----------------------------------------------------------------------
   * 简单减压，不消耗体力，不消耗经费。
   * 每次休息降低 8 点压力。
   * ======================================================================== */

  /**
   * 处理休息行动
   *
   * @param {string}     actionName - 行动名称
   * @param {Object}     action     - 行动定义
   * @param {Student[]}  students   - 参与学生数组
   * @param {Object}     options    - 选项
   * @param {number}     week       - 当前周数
   * @returns {Object} {success, events, summary}
   */
  RealTraining._doRest = function (actionName, action, students, options, week) {
    var events = [];
    var pressureRelief = 8;

    for (var i = 0; i < students.length; i++) {
      var s = students[i];

      // 压力已经为 0 时无需额外处理
      var actualChange = (s.pressure <= 0) ? 0 : -Math.min(pressureRelief, s.pressure);
      s.pressure = Math.max(0, s.pressure + actualChange);

      // --- 天赋触发：休息结束事件（劳逸结合等） ---
      if (typeof s.triggerTalents === 'function') {
        s.triggerTalents('rest_finished', { pressureRelief: Math.abs(actualChange) });
      }

      events.push({
        type: 'rest',
        student: s.name,
        pressureChange: actualChange
      });
    }

    var summary = students.length + ' 名学生进行了休息';
    return { success: true, events: events, summary: summary };
  };

  /* ========================================================================
   * 娱乐
   * -----------------------------------------------------------------------
   * 大幅降低压力（-20），但会导致少量知识遗忘。
   * 仅遗忘当前值 >15 的知识点，遗忘量较小（0~1）。
   * ======================================================================== */

  /**
   * 处理娱乐行动
   *
   * @param {string}     actionName - 行动名称
   * @param {Object}     action     - 行动定义
   * @param {Student[]}  students   - 参与学生数组
   * @param {Object}     options    - 选项
   * @param {number}     week       - 当前周数
   * @returns {Object} {success, events, summary}
   */
  RealTraining._doEntertainment = function (actionName, action, students, options, week) {
    var events = [];
    var knowledgeLossBase = action.knowledgeLoss || 1;

    for (var i = 0; i < students.length; i++) {
      var s = students[i];

      // --- 大幅降低压力 ---
      var pressureRelief = 20;
      var actualPressureChange = (s.pressure <= 0) ? 0 : -Math.min(pressureRelief, s.pressure);
      s.pressure = Math.max(0, s.pressure + actualPressureChange);

      // --- 知识遗忘（仅遗忘 >15 的知识点） ---
      var knowledgeLosses = {};
      for (var a = 0; a < KNOWLEDGE_AREAS.length; a++) {
        var areaName = KNOWLEDGE_AREAS[a];
        var currentK = 0;
        if (typeof s.getKnowledgeByType === 'function') {
          currentK = s.getKnowledgeByType(areaName);
        }
        if (currentK > 15) {
          // 遗忘 0~knowledgeLossBase 点
          var loss = Math.floor(knowledgeLossBase * _rand());
          if (loss > 0) {
            s.addKnowledge(areaName, -loss);
            knowledgeLosses[areaName] = loss;
          }
        }
      }

      // --- 天赋触发：娱乐结束事件 ---
      if (typeof s.triggerTalents === 'function') {
        s.triggerTalents('entertainment_finished', { pressureRelief: Math.abs(actualPressureChange) });
      }

      // --- 记录事件 ---
      events.push({
        type: 'entertainment',
        student: s.name,
        pressureChange: actualPressureChange,
        knowledgeLosses: knowledgeLosses,
        hasKnowledgeLoss: Object.keys(knowledgeLosses).length > 0
      });
    }

    var summary = students.length + ' 名学生进行了娱乐';
    return { success: true, events: events, summary: summary };
  };

  /* ========================================================================
   * 任务选择辅助
   * ======================================================================== */

  /**
   * 从任务池中随机选择指定数量的任务
   *
   * 可选筛选条件：
   *   - difficultyRange: [min, max] 难度范围
   *   - knowledgeType: 知识点中文名（任务 boosts 中需包含该类型）
   *
   * @param {number} count   - 需要选取的任务数量，默认 7
   * @param {Object} options  - 筛选选项
   * @returns {Array} 选中的任务对象数组
   */
  RealTraining.selectRandomTasks = function (count, options) {
    var pool = window.REAL_TASK_POOL;
    if (!pool || !Array.isArray(pool)) {
      return [];
    }

    var filtered = pool;

    // --- 难度范围筛选 ---
    if (options && options.difficultyRange && Array.isArray(options.difficultyRange)) {
      var minDiff = Number(options.difficultyRange[0]) || 0;
      var maxDiff = Number(options.difficultyRange[1]) || Infinity;
      filtered = [];
      for (var i = 0; i < pool.length; i++) {
        var t = pool[i];
        if (t.difficulty >= minDiff && t.difficulty <= maxDiff) {
          filtered.push(t);
        }
      }
    }

    // --- 知识点类型筛选 ---
    if (options && options.knowledgeType) {
      var targetType = options.knowledgeType;
      var temp = [];
      for (var j = 0; j < filtered.length; j++) {
        var task = filtered[j];
        var found = false;
        if (task.boosts && Array.isArray(task.boosts)) {
          for (var k = 0; k < task.boosts.length; k++) {
            if (task.boosts[k].type === targetType) {
              found = true;
              break;
            }
          }
        }
        if (found) {
          temp.push(task);
        }
      }
      filtered = temp;
    }

    // --- Fisher-Yates 洗牌并截取前 count 个 ---
    var resultCount = (typeof count === 'number' && count > 0) ? count : DEFAULT_TASK_COUNT;

    // 复制数组用于洗牌（不修改原数组）
    var shuffled = filtered.slice();
    for (var si = shuffled.length - 1; si > 0; si--) {
      var sj = Math.floor(_rand() * (si + 1));
      var tmp = shuffled[si];
      shuffled[si] = shuffled[sj];
      shuffled[sj] = tmp;
    }

    return shuffled.slice(0, resultCount);
  };

  /* ========================================================================
   * 体力辅助
   * ======================================================================== */

  /**
   * 获取体力训练效率倍率（公开版本，供外部调用）
   * @param {Student} student - 学生对象
   * @returns {number} 效率倍率 (0.6 ~ 1.0)
   */
  RealTraining._getStaminaEfficiency = function (student) {
    if (!student) return STAMINA_FLOOR_MULTIPLIER;
    return _getStaminaEfficiency(student.stamina);
  };

  /**
   * 每周体力恢复
   *
   * 恢复公式：基础 5 + 体质/20
   * 额外加成：夜猫子性格的 staminaRecoveryBonus
   * 体力上限不超过 maxStamina（默认 100）。
   *
   * @param {Student} student - 学生对象
   * @param {number}  weeks   - 恢复的周数，默认 1
   */
  RealTraining.recoverStamina = function (student, weeks) {
    if (!student) return;

    weeks = (typeof weeks === 'number' && weeks > 0) ? weeks : 1;

    // 基础恢复量：5 + physique / 20
    var baseRecovery = 5 + Math.floor((student.physique || 50) / 20);

    // 夜猫子性格加成（staminaRecoveryBonus）
    var pm = _getPersonalityManager();
    if (pm && typeof pm.getVisibleEffect === 'function') {
      var nightOwlBonus = pm.getVisibleEffect(student, 'staminaRecoveryBonus');
      if (typeof nightOwlBonus === 'number') {
        baseRecovery += nightOwlBonus;
      }
    }

    // 应用恢复（不超过上限）
    var maxSt = student.maxStamina || 100;
    student.stamina = Math.min(maxSt, student.stamina + baseRecovery * weeks);
  };

  /* ========================================================================
   * 训练预览（UI 展示用，不实际修改学生状态）
   * ======================================================================== */

  /**
   * 预览行动效果（不实际应用）
   *
   * 用于 UI 提示玩家某次行动的大致影响。
   * 注意：预览值仅为估算值，实际执行时受随机波动影响。
   *
   * @param {string} actionName - 行动名称
   * @param {Student} student   - 目标学生
   * @param {Object} options    - 选项（如 task, intensity）
   * @returns {Object|null} 预览结果，或 null（行动不存在）
   */
  RealTraining.previewAction = function (actionName, student, options) {
    var action = window.REAL_ACTIONS ? window.REAL_ACTIONS[actionName] : null;
    if (!action || !student) {
      return null;
    }

    var pm = _getPersonalityManager();

    // ---------- 基础预览字段 ----------
    var preview = {
      actionName: actionName,
      type: action.type,
      cost: action.cost || 0,
      staminaCost: action.staminaCost || 0,
      pressureChange: action.pressureChange || 0
    };

    // ---------- 高强度训练特殊处理 ----------
    if (actionName === '高强度训练') {
      preview.staminaCost = Math.floor(preview.staminaCost * 1.5);
      preview.pressureChange = Math.floor(preview.pressureChange * 1.3);

      // 应用训练强度倍率到压力
      var intensity = (options && options.intensity) || DEFAULT_INTENSITY;
      var intensityMult = INTENSITY_MULTIPLIERS[intensity] || INTENSITY_MULTIPLIERS[DEFAULT_INTENSITY];
      preview.pressureChange = Math.floor(preview.pressureChange * intensityMult);
    }

    // ---------- 训练类型：估算知识增益 ----------
    if (action.type === 'training' && options && options.task) {
      var task = options.task;
      var intensity = (options.intensity) || DEFAULT_INTENSITY;
      var intensityMult = INTENSITY_MULTIPLIERS[intensity] || INTENSITY_MULTIPLIERS[DEFAULT_INTENSITY];
      var facilityMult = _getFacilityMultiplier();
      var staminaMod = _getStaminaEfficiency(student.stamina);

      preview.knowledgeEstimate = {};
      for (var b = 0; b < task.boosts.length; b++) {
        var boost = task.boosts[b];
        var est = (boost.amount || 0) * intensityMult * staminaMod * facilityMult;

        if (pm) {
          est = pm.applyTrainingModifier(student, est, student.pressure);
        }

        preview.knowledgeEstimate[boost.type] = Math.max(0, Math.floor(est));
      }
    }

    // ---------- 集训：估算知识增益 ----------
    if (action.type === 'camp') {
      preview.knowledgeEstimate = {};
      var facilityMult = _getFacilityMultiplier();
      for (var a = 0; a < KNOWLEDGE_AREAS.length; a++) {
        var est = Math.floor((3 + _rand() * 5) * facilityMult);
        if (pm) {
          est = pm.applyTrainingModifier(student, est, student.pressure);
        }
        preview.knowledgeEstimate[KNOWLEDGE_AREAS[a]] = Math.max(0, est);
      }
    }

    // ---------- 运动类型：压力变化取决于体力 ----------
    if (action.type === 'exercise') {
      if (student.stamina >= 70) {
        preview.pressureChange = -20;
        preview.staminaCost = 10;
      } else if (student.stamina >= 40) {
        preview.pressureChange = -10;
        preview.staminaCost = 5;
      } else {
        preview.pressureChange = 5;
        preview.staminaCost = 5;
      }
    }

    // ---------- 修习文化课 ----------
    if (action.type === 'academic') {
      preview.academicGain = Math.floor((action.academicGain || 8) * (0.8 + _rand() * 0.4));
      preview.pressureChange = -3;
      preview.staminaCost = 0;
    }

    // ---------- 休息 ----------
    if (action.type === 'rest') {
      preview.pressureChange = -8;
      preview.staminaCost = 0;
    }

    // ---------- 娱乐 ----------
    if (action.type === 'entertainment') {
      preview.pressureChange = -20;
      preview.staminaCost = 0;
      preview.knowledgeLoss = true;
    }

    // ---------- 应用性格修正到压力变化（运动/休息/娱乐等） ----------
    if (pm && preview.pressureChange !== 0) {
      preview.pressureChange = pm.applyPressureModifier(student, preview.pressureChange);
    }

    return preview;
  };

  /* ========================================================================
   * 批量操作辅助
   * ======================================================================== */

  /**
   * 批量为多名学生恢复体力（一周结算时调用）
   *
   * @param {Student[]} students - 学生数组
   * @param {number}    weeks    - 恢复周数，默认 1
   */
  RealTraining.recoverAllStamina = function (students, weeks) {
    if (!students || !Array.isArray(students)) return;
    for (var i = 0; i < students.length; i++) {
      RealTraining.recoverStamina(students[i], weeks);
    }
  };

  /**
   * 获取指定学生的体力状态描述（UI 展示用）
   *
   * @param {Student} student - 学生对象
   * @returns {Object} {stamina, maxStamina, percent, level, color}
   */
  RealTraining.getStaminaInfo = function (student) {
    if (!student) {
      return { stamina: 0, maxStamina: 100, percent: 0, level: '无', color: '#ccc' };
    }

    var st = Math.max(0, student.stamina || 0);
    var maxSt = student.maxStamina || 100;
    var pct = maxSt > 0 ? st / maxSt : 0;

    var level, color;
    if (pct >= 0.6) {
      level = '充沛';
      color = '#2ecc71'; // 绿色
    } else if (pct >= 0.3) {
      level = '正常';
      color = '#f1c40f'; // 黄色
    } else {
      level = '疲劳';
      color = '#e74c3c'; // 红色
    }

    return {
      stamina: st,
      maxStamina: maxSt,
      percent: Math.round(pct * 100),
      level: level,
      color: color
    };
  };

  /* ========================================================================
   * 加载完成提示（开发阶段使用，上线后可移除）
   * ======================================================================== */
  if (typeof console !== 'undefined') {
    console.log('[Real Mode] real-training.js 加载完成 — 训练行动系统就绪');
  }

})();
