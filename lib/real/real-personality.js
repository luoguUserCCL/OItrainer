/**
 * real-personality.js - Real Mode 性格（personality）系统
 * 
 * 性格与天赋（talent）是完全独立的系统：
 *   - 天赋由 TalentManager 管理，事件驱动的技能触发
 *   - 性格由 PersonalityManager 管理，持续生效的被动效果
 *
 * 规则概要：
 *   1. 每名学生恰好拥有 1 个可见性格 + 0~2 个隐藏性格
 *   2. 隐藏性格在 UI 中不显示，效果静默生效
 *   3. 性格在学生创建时一次性分配，之后不再改变
 */

(function(global) {
  'use strict';

  /* ========== 工具函数 ========== */

  /**
   * Fisher-Yates 洗牌算法（使用全局 getRandom）
   * @param {Array} arr - 待洗牌的数组（原地修改并返回）
   * @returns {Array} 洗牌后的数组
   */
  function shuffle(arr) {
    var i, j, tmp;
    for (i = arr.length - 1; i > 0; i--) {
      j = Math.floor(getRandom() * (i + 1));
      tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /**
   * 判断某个 effectKey 是否为"乘法类型"
   * 乘法类型的 key 在多个性格同时拥有时应该相乘，而非相加。
   */
  function isMultiplicativeKey(key) {
    return key.indexOf('Multiplier') >= 0;
  }

  /* ========== 知识点名称列表（用于偏科型选手随机选择） ========== */
  var KNOWLEDGE_KEYS = [
    'knowledge_ds',
    'knowledge_graph',
    'knowledge_string',
    'knowledge_math',
    'knowledge_dp'
  ];
  var KNOWLEDGE_NAMES = {
    'knowledge_ds': '数据结构',
    'knowledge_graph': '图论',
    'knowledge_string': '字符串',
    'knowledge_math': '数学',
    'knowledge_dp': '动态规划'
  };

  /* ========== 性格定义 ========== */
  var PERSONALITY_DEFS = [
    // ---- 可见性格（10 个） ----
    {
      name: '全能型选手',
      visible: true,
      description: '各项训练效果均衡提升5%，没有短板也没有特长。',
      effects: {
        knowledgeGainMultiplier: 1.05
      }
    },
    {
      name: '思维型选手',
      visible: true,
      description: '思维能力突出（+15），但代码实现能力偏弱（-10）。',
      effects: {
        thinkingBonus: 15,
        codingBonus: -10
      }
    },
    {
      name: '代码手',
      visible: true,
      description: '代码能力出色（+20），但思维能力不足（-10）。',
      effects: {
        codingBonus: 20,
        thinkingBonus: -10
      }
    },
    {
      name: '偏科型选手',
      visible: true,
      description: '在某一个知识方向特别擅长（+20），其余方向偏弱（-10）。',
      effects: {
        // 实际效果在 assignPersonalities 时动态确定并存储到 student._personalityState
        _specialized: true
      }
    },
    {
      name: '追求完美者',
      visible: true,
      description: 'OI 赛制中分数流失速度减半，更不容易丢已拿到的部分分。',
      effects: {
        scoreLossResist: 0.5
      }
    },
    {
      name: '强最优解型选手',
      visible: true,
      description: '比赛开始时固定花费30分钟准备模板，模板完成后做题速度加快，全部题目得分+10%（单题封顶100）',
      effects: {
        contestStartDelay: 30,         // 固定30分钟（分钟数），非比例
        problemSolvingSpeedBonus: 0.3,  // 模板完成后做题速度+30%
        scoreBonus: 0.10,               // 得分+10%
        scoreCapPerProblem: 100         // 单题得分封顶100
      }
    },
    {
      name: '稳健型选手',
      visible: true,
      description: '训练中压力增加幅度降低20%，更不容易崩溃。',
      effects: {
        pressureChangeMultiplier: 0.8
      }
    },
    {
      name: '冲刺型选手',
      visible: true,
      description: '擅长难题（+15%得分加成），但在简单题上表现略逊（-10%）。',
      effects: {
        highDifficultyBonus: 0.15,
        lowDifficultyPenalty: 0.1
      }
    },
    {
      name: '厚积薄发型选手',
      visible: true,
      description: '每次训练额外+2点知识增益，但比赛中每题最多只拿85%的分数。',
      effects: {
        trainingFlatBonus: 2,
        contestScoreCapRatio: 0.85
      }
    },
    {
      name: '节奏大师',
      visible: true,
      description: '比赛中各题保底获得20%的分数，不会出现0分题，但高分题（>80分）得分降低8%。',
      effects: {
        minProblemScoreRatio: 0.2,     // 每题保底20%
        highScorePenalty: 0.08         // 单题>80分时扣8%
      }
    },

    // ---- 隐藏性格（4 个） ----
    {
      name: '猥琐发育',
      visible: false,
      description: '模拟赛表现极差（×0.5），但正式比赛爆发（×1.5）。',
      effects: {
        mockScoreMultiplier: 0.5,
        formalScoreMultiplier: 1.5
      }
    },
    {
      name: '自虐狂',
      visible: false,
      description: '压力越高训练效果越好（1+pressure/50），且永不崩溃。',
      effects: {
        _masochist: true,
        _neverCollapse: true
      }
    },
    {
      name: '大赛型选手',
      visible: false,
      description: '正式比赛表现优异（×1.3），模拟赛略逊（×0.9）。',
      effects: {
        formalScoreMultiplier: 1.3,
        mockScoreMultiplier: 0.9
      }
    },
    {
      name: '夜猫子',
      visible: false,
      description: '体力恢复速度额外+5/周，但训练压力增加+3。',
      effects: {
        staminaRecoveryBonus: 5,
        trainingPressureChange: 3
      }
    }
  ];

  /* ========== PersonalityManager ========== */
  var PersonalityManager = {

    /** 所有性格定义的映射表：name → definition */
    _personalities: {},

    /** 可见性格名称列表 */
    _visibleList: [],

    /** 隐藏性格名称列表 */
    _hiddenList: [],

    /**
     * 初始化：注册所有性格定义
     * 建议在游戏启动时调用一次
     */
    init: function() {
      var self = this;
      self._personalities = {};
      self._visibleList = [];
      self._hiddenList = [];

      var i, def;
      for (i = 0; i < PERSONALITY_DEFS.length; i++) {
        def = PERSONALITY_DEFS[i];
        self._personalities[def.name] = def;
        if (def.visible) {
          self._visibleList.push(def.name);
        } else {
          self._hiddenList.push(def.name);
        }
      }
    },

    /**
     * 为学生分配性格及相关 Real Mode 属性
     *
     * 分配流程：
     *   1. 将所有性格名称混合洗牌
     *   2. 取第一张 → 若为隐藏性格则放入 hiddenPersonalities，继续抽
     *   3. 取第二张 → 若仍为隐藏性格则放入 hiddenPersonalities，继续抽
     *   4. 取第三张 → 此时池中可见:隐藏 = 10:2（若抽了2个隐藏），
     *      概率上几乎必定抽到可见性格（10/12 = 83.3%），且在最坏情况下
     *      仍有 10:2 的比例优势，持续抽即可
     *   5. 最终结果：1 个可见 + 0~2 个隐藏
     *
     * 同时设置以下学生属性（Real Mode 专用）：
     *   - gender: 性别（7:1 男:女）
     *   - physique: 先天体质 (20~100)
     *   - stamina / maxStamina: 动态体力 / 体力上限
     *   - academicScore: 文化课成绩 (30~70)
     *   - personality / hiddenPersonalities: 性格分配结果
     *
     * @param {Object} student - 学生对象
     */
    assignPersonalities: function(student) {
      if (!student) return;

      var self = this;
      // 拼接所有性格名称并洗牌
      var allNames = self._visibleList.concat(self._hiddenList);
      var shuffled = shuffle(allNames.slice());

      var hiddenList = [];
      var visibleName = null;
      var idx = 0;

      // 最多抽取 3 次：可见:隐藏 = 10:4，3 次内必能抽到可见性格
      while (idx < shuffled.length) {
        var name = shuffled[idx];
        var def = self._personalities[name];
        idx++;

        if (def && def.visible) {
          // 抽到可见性格，分配完毕
          visibleName = name;
          break;
        } else if (def && !def.visible) {
          // 抽到隐藏性格，记录并继续抽
          hiddenList.push(name);
          // 最多允许 2 个隐藏性格
          if (hiddenList.length >= 2) {
            // 继续抽取直到找到可见性格
            while (idx < shuffled.length) {
              var nextName = shuffled[idx];
              var nextDef = self._personalities[nextName];
              idx++;
              if (nextDef && nextDef.visible) {
                visibleName = nextName;
                break;
              }
            }
            break;
          }
          // 继续抽取下一个
        } else {
          // 未知定义（不应出现），跳过
          continue;
        }
      }

      // 安全兜底：如果最终没抽到可见性格（极端情况），随机从可见列表中选一个
      if (!visibleName && self._visibleList.length > 0) {
        visibleName = self._visibleList[Math.floor(getRandom() * self._visibleList.length)];
      }

      // 设置性格属性
      student.personality = visibleName;
      student.hiddenPersonalities = hiddenList;

      // 如果可见性格是"偏科型选手"，需要随机确定专精的知识方向
      if (visibleName === '偏科型选手') {
        var specIdx = Math.floor(getRandom() * KNOWLEDGE_KEYS.length);
        var specKey = KNOWLEDGE_KEYS[specIdx];
        // 将偏科信息存储到学生对象上
        student._personalityState = {
          specializedKnowledge: specKey,
          specializedKnowledgeName: KNOWLEDGE_NAMES[specKey]
        };
      }

      // ---- Real Mode 属性分配 ----

      // 性别：7:1 男:女
      student.gender = (getRandom() < (1.0 / 8.0)) ? 'female' : 'male';

      // 先天体质 (20~100)
      student.physique = uniformInt(20, 100);

      // 体力上限 = 50 + physique/2
      student.maxStamina = 50 + Math.floor(student.physique / 2);

      // 初始体力 (40 ~ maxStamina)，不超上限 100
      var staminaCap = Math.min(100, student.maxStamina);
      student.stamina = uniformInt(40, staminaCap);

      // 文化课成绩 (30~70)
      student.academicScore = uniformInt(30, 70);
    },

    /**
     * 根据名称获取性格定义
     * @param {string} name - 性格名称
     * @returns {Object|null} 性格定义对象，不存在时返回 null
     */
    getPersonality: function(name) {
      if (!name) return null;
      return this._personalities[name] || null;
    },

    /**
     * 获取学生某个效果 key 的合并值（可见 + 隐藏性格叠加）
     *
     * 合并规则：
     *   - 乘法类型（key 含 "Multiplier"）：各值相乘
     *   - 加法类型（其他）：各值相加
     *   - 特殊类型（如偏科、自虐）由 getAllEffects 处理
     *
     * @param {Object} student - 学生对象
     * @param {string} effectKey - 效果键名
     * @returns {number|undefined} 合并后的效果值，无此效果时返回 undefined
     */
    getVisibleEffect: function(student, effectKey) {
      if (!student || !effectKey) return undefined;

      var allEffects = this.getAllEffects(student);
      if (!allEffects || typeof allEffects[effectKey] === 'undefined') {
        return undefined;
      }
      return allEffects[effectKey];
    },

    /**
     * 获取学生所有生效效果的合并映射
     *
     * 遍历可见性格 + 所有隐藏性格，将同名的 effectKey 合并。
     * 特殊处理：
     *   - 偏科型选手（_specialized）：生成 specializedBonus 对象
     *   - 自虐狂（_masochist）：生成动态 trainingGainMultiplier
     *
     * @param {Object} student - 学生对象
     * @returns {Object} { effectKey: combinedValue, ... }
     */
    getAllEffects: function(student) {
      if (!student) return {};

      var self = this;
      var result = {};

      // 收集所有生效的性格（可见 + 隐藏）
      var activePersonalities = [];
      if (student.personality) {
        activePersonalities.push(student.personality);
      }
      if (Array.isArray(student.hiddenPersonalities)) {
        var i;
        for (i = 0; i < student.hiddenPersonalities.length; i++) {
          activePersonalities.push(student.hiddenPersonalities[i]);
        }
      }

      // 第一步：收集原始效果值
      // rawMap: { key: [value1, value2, ...] }
      var rawMap = {};
      var j, pName, pDef, key;
      for (j = 0; j < activePersonalities.length; j++) {
        pName = activePersonalities[j];
        pDef = self._personalities[pName];
        if (!pDef || !pDef.effects) continue;

        for (key in pDef.effects) {
          if (!pDef.effects.hasOwnProperty(key)) continue;

          var val = pDef.effects[key];

          // 特殊标记：_specialized（偏科型选手）
          if (key === '_specialized' && val === true) {
            // 不参与合并，留到特殊处理
            continue;
          }
          // 特殊标记：_masochist（自虐狂动态倍率）
          if (key === '_masochist' && val === true) {
            continue;
          }
          // 特殊标记：_neverCollapse（自虐狂不崩溃）
          if (key === '_neverCollapse' && val === true) {
            result._neverCollapse = true;
            continue;
          }

          if (!rawMap[key]) {
            rawMap[key] = [];
          }
          rawMap[key].push(val);
        }
      }

      // 第二步：合并原始效果值
      for (key in rawMap) {
        if (!rawMap.hasOwnProperty(key)) continue;
        var values = rawMap[key];

        if (isMultiplicativeKey(key)) {
          // 乘法类型：各值相乘
          var product = 1.0;
          var k;
          for (k = 0; k < values.length; k++) {
            product = product * (Number(values[k]) || 1.0);
          }
          result[key] = product;
        } else {
          // 加法类型：各值相加
          var sum = 0;
          var m;
          for (m = 0; m < values.length; m++) {
            sum = sum + (Number(values[m]) || 0);
          }
          result[key] = sum;
        }
      }

      // 第三步：特殊处理 —— 偏科型选手
      if (student._personalityState && student._personalityState.specializedKnowledge) {
        var specKey = student._personalityState.specializedKnowledge;
        result.specializedBonus = {};
        var nk;
        for (nk = 0; nk < KNOWLEDGE_KEYS.length; nk++) {
          var kName = KNOWLEDGE_KEYS[nk];
          if (kName === specKey) {
            result.specializedBonus[kName] = 20;
          } else {
            result.specializedBonus[kName] = -10;
          }
        }
      }

      // 第四步：特殊处理 —— 自虐狂的动态训练倍率
      // trainingGainMultiplier = 1 + pressure / 50
      if (self.hasHiddenPersonality(student, '自虐狂')) {
        var pressure = Number(student.pressure) || 0;
        var masochistMult = 1.0 + pressure / 50.0;
        // 若已有其他来源的 trainingGainMultiplier，与之相乘
        if (typeof result.trainingGainMultiplier === 'number') {
          result.trainingGainMultiplier = result.trainingGainMultiplier * masochistMult;
        } else {
          result.trainingGainMultiplier = masochistMult;
        }
      }

      return result;
    },

    /**
     * 判断学生是否拥有指定的隐藏性格
     * @param {Object} student - 学生对象
     * @param {string} name - 性格名称
     * @returns {boolean}
     */
    hasHiddenPersonality: function(student, name) {
      if (!student || !name) return false;
      if (!Array.isArray(student.hiddenPersonalities)) return false;
      var i;
      for (i = 0; i < student.hiddenPersonalities.length; i++) {
        if (student.hiddenPersonalities[i] === name) return true;
      }
      return false;
    },

    /* ========== 效果应用辅助方法 ========== */

    /**
     * 应用得分修改器（单题级别）
     *
     * 综合以下效果对每道题得分进行修正：
     *   - scoreBonus：加成比例（如 0.10 表示 +10%）
     *   - scoreCapPerProblem：单题得分封顶（如 100）
     *   - minProblemScoreRatio：每题保底比例（如 0.2 = 保底20%满分）
     *   - highScorePenalty：高分题惩罚（如单题>80分时扣8%）
     *   - mockScoreMultiplier / formalScoreMultiplier：比赛类型专属乘数
     *
     * @param {Object} student - 学生对象
     * @param {number} score - 单题基础得分
     * @param {number} maxScore - 该题满分（用于保底计算）
     * @param {string} contestType - 比赛类型：'mock' 或 'formal'
     * @returns {number} 修正后的得分
     */
    applyScoreModifier: function(student, score, contestType, maxScore) {
      if (!student) return score;
      var s = Number(score) || 0;

      var effects = this.getAllEffects(student);
      var cap = Number(maxScore) || 100;

      // 节奏大师：每题保底 20% 满分
      if (typeof effects.minProblemScoreRatio === 'number' && effects.minProblemScoreRatio > 0) {
        var minScore = Math.floor(cap * effects.minProblemScoreRatio);
        if (s < minScore) s = minScore;
      }

      // 通用加成（scoreBonus）：如强最优解型选手的 +10%
      if (typeof effects.scoreBonus === 'number' && effects.scoreBonus !== 0) {
        s = s * (1.0 + effects.scoreBonus);
      }

      // 强最优解型选手：单题得分封顶 100
      if (typeof effects.scoreCapPerProblem === 'number') {
        s = Math.min(s, effects.scoreCapPerProblem);
      }

      // 厚积薄发型选手：每题最多拿满分的 85%
      if (typeof effects.contestScoreCapRatio === 'number' && effects.contestScoreCapRatio > 0) {
        s = Math.min(s, Math.floor(cap * effects.contestScoreCapRatio));
      }

      // 节奏大师：非满分的高分题（>80分且<满分）扣 8%
      if (typeof effects.highScorePenalty === 'number' && effects.highScorePenalty > 0 && s > 80 && s < cap) {
        s = Math.floor(s * (1.0 - effects.highScorePenalty));
      }

      // 比赛类型专属乘数
      if (contestType === 'mock') {
        if (typeof effects.mockScoreMultiplier === 'number') {
          s = s * effects.mockScoreMultiplier;
        }
      } else if (contestType === 'formal') {
        if (typeof effects.formalScoreMultiplier === 'number') {
          s = s * effects.formalScoreMultiplier;
        }
      }

      return s;
    },

    /**
     * 应用训练增益修改器
     *
     * 综合以下效果对训练知识增幅进行修正：
     *   - knowledgeGainMultiplier：知识增益乘数（如全能型选手 ×1.05）
     *   - trainingGainMultiplier：训练增益乘数（如自虐狂的 1+pressure/50）
     *
     * @param {Object} student - 学生对象
     * @param {number} baseGain - 基础训练增益
     * @param {number} pressure - 当前压力值（用于自虐狂动态计算）
     * @returns {number} 修正后的训练增益
     */
    applyTrainingModifier: function(student, baseGain, pressure) {
      if (!student) return baseGain;
      var gain = Number(baseGain) || 0;

      // 临时更新学生压力（确保自虐狂计算时使用最新值）
      if (typeof pressure === 'number') {
        student.pressure = pressure;
      }

      var effects = this.getAllEffects(student);

      // 知识增益乘数
      if (typeof effects.knowledgeGainMultiplier === 'number') {
        gain = gain * effects.knowledgeGainMultiplier;
      }

      // 厚积薄发型选手：固定额外 +2
      if (typeof effects.trainingFlatBonus === 'number' && effects.trainingFlatBonus > 0) {
        gain = gain + effects.trainingFlatBonus;
      }

      // 训练增益乘数（包含自虐狂的动态效果）
      if (typeof effects.trainingGainMultiplier === 'number') {
        gain = gain * effects.trainingGainMultiplier;
      }

      return gain;
    },

    /**
     * 应用压力变化修改器
     *
     * 综合以下效果对训练产生的压力变化进行修正：
     *   - pressureChangeMultiplier：压力变化乘数（如稳健型选手 ×0.8）
     *   - trainingPressureChange：额外压力变化量（如夜猫子的 +3）
     *
     * @param {Object} student - 学生对象
     * @param {number} basePressureChange - 基础压力变化量
     * @returns {number} 修正后的压力变化量
     */
    applyPressureModifier: function(student, basePressureChange) {
      if (!student) return basePressureChange;
      var change = Number(basePressureChange) || 0;

      var effects = this.getAllEffects(student);

      // 压力变化乘数（如稳健型选手：0.8，即压力增加减少 20%）
      if (typeof effects.pressureChangeMultiplier === 'number') {
        change = change * effects.pressureChangeMultiplier;
      }

      // 额外压力变化量（如夜猫子：+3）
      if (typeof effects.trainingPressureChange === 'number') {
        change = change + effects.trainingPressureChange;
      }

      return change;
    }
  };

  /* ========== 导出到全局 ========== */
  global.PersonalityManager = PersonalityManager;

  /* ========== 自动初始化 ========== */
  PersonalityManager.init();

})(typeof window !== 'undefined' ? window : this);
