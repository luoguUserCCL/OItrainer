/* ==========================================================================
 * real-data.js — OItrainer「Real Mode」核心数据定义
 * --------------------------------------------------------------------------
 * 本文件在原始游戏的 lib/constants.js、lib/utils.js、lib/models.js、
 * lib/talent.js 之后加载，用于覆盖/扩展全局数据以支持 Real Mode。
 *
 * 风格约定：
 *   - 使用 var / const，不使用 let
 *   - 不使用箭头函数、模板字符串、解构等 ES6+ 特性
 *   - 所有全局挂载统一使用 window.* 前缀
 *   - 注释使用中文
 * ========================================================================== */

(function () {

  /* ========================================================================
   * 第 1 节：Real Mode 常量覆盖
   * ======================================================================== */

  // 标记当前处于 Real Mode
  window.REAL_MODE = true;

  // Real Mode 使用 140 周赛季（约三年）
  // Y1 Sep W1 = 第 1 周，Y4 Jul W4 = 第 140 周
  // 每月恰好 4 周
  // 链1 = Y1 Sep → Y3 Jul（CSP→NOIP→省选→NOI→CTT→WC→CTS→IOI）
  // 链2 = Y2 Sep → Y4 Jul（CSP→NOIP→省选→NOI→CTT→WC→CTS→IOI，两条链相互独立）
  // 第二个IOI结束后游戏立刻结束
  window.SEASON_WEEKS = 140;

  // 每学年周数，仅供兼容性保留
  window.WEEKS_PER_HALF = 70;

  // 知识权重 / 能力权重（沿用原始值）
  window.KNOWLEDGE_WEIGHT = 0.6;
  window.ABILITY_WEIGHT = 0.4;

  // 能力衰减阈值（沿用原始值）
  window.ABILITY_DECAY_THRESHOLD = 400;

  /* ========================================================================
   * 第 2 节：日历系统 — RealCalendar
   * -----------------------------------------------------------------------
   * Real Mode 将 144 周映射到 3 个完整学年（每学年 1 年 = 48 周）：
   *   每月恰好 4 周，每年 48 周，全游戏 144 周
   *   Year 1 高一（9月→次年8月）
   *   Year 2 高二（9月→次年8月）
   *   Year 3 高三（9月→次年8月）
   *
   * Year 1（高一）：
   *   九月  = 第  1- 4 周   十月  = 第  5- 8 周
   *   十一月= 第  9-12 周   十二月= 第 13-16 周
   *   一月  = 第 17-20 周   二月  = 第 21-24 周
   *   三月  = 第 25-28 周   四月  = 第 29-32 周
   *   五月  = 第 33-36 周   六月  = 第 37-40 周
   *   七月  = 第 41-44 周   八月  = 第 45-48 周
   * Year 2（高二）：
   *   九月  = 第 49-52 周   十月  = 第 53-56 周
   *   十一月= 第 57-60 周   十二月= 第 61-64 周
   *   一月  = 第 65-68 周   二月  = 第 69-72 周
   *   三月  = 第 73-76 周   四月  = 第 77-80 周
   *   五月  = 第 81-84 周   六月  = 第 85-88 周
   *   七月  = 第 89-92 周   八月  = 第 93-96 周
   * Year 3（高三）：
   *   九月  = 第 97-100 周   十月  = 第101-104 周
   *   十一月= 第105-108 周   十二月= 第109-112 周
   *   一月  = 第113-116 周   二月  = 第117-120 周
   *   三月  = 第121-124 周   四月  = 第125-128 周
   *   五月  = 第129-132 周   六月  = 第133-136 周
   *   七月  = 第137-140 周
   * ======================================================================== */

  // 月份配置表：{ month: 月份中文名, short: 简写, range: [startWeek, endWeek], year: 学年 }
  var REAL_MONTH_TABLE = [
    // Year 1（高一）
    { month: '九月',   short: '9月',  range: [1,   4],  year: 1 },
    { month: '十月',   short: '10月', range: [5,   8],  year: 1 },
    { month: '十一月', short: '11月', range: [9,   12], year: 1 },
    { month: '十二月', short: '12月', range: [13,  16], year: 1 },
    { month: '一月',   short: '1月',  range: [17,  20], year: 1 },
    { month: '二月',   short: '2月',  range: [21,  24], year: 1 },
    { month: '三月',   short: '3月',  range: [25,  28], year: 1 },
    { month: '四月',   short: '4月',  range: [29,  32], year: 1 },
    { month: '五月',   short: '5月',  range: [33,  36], year: 1 },
    { month: '六月',   short: '6月',  range: [37,  40], year: 1 },
    { month: '七月',   short: '7月',  range: [41,  44], year: 1 },
    { month: '八月',   short: '8月',  range: [45,  48], year: 1 },
    // Year 2（高二）
    { month: '九月',   short: '9月',  range: [49,  52], year: 2 },
    { month: '十月',   short: '10月', range: [53,  56], year: 2 },
    { month: '十一月', short: '11月', range: [57,  60], year: 2 },
    { month: '十二月', short: '12月', range: [61,  64], year: 2 },
    { month: '一月',   short: '1月',  range: [65,  68], year: 2 },
    { month: '二月',   short: '2月',  range: [69,  72], year: 2 },
    { month: '三月',   short: '3月',  range: [73,  76], year: 2 },
    { month: '四月',   short: '4月',  range: [77,  80], year: 2 },
    { month: '五月',   short: '5月',  range: [81,  84], year: 2 },
    { month: '六月',   short: '6月',  range: [85,  88], year: 2 },
    { month: '七月',   short: '7月',  range: [89,  92], year: 2 },
    { month: '八月',   short: '8月',  range: [93,  96], year: 2 },
    // Year 3（高三）
    { month: '九月',   short: '9月',  range: [97,  100], year: 3 },
    { month: '十月',   short: '10月', range: [101, 104], year: 3 },
    { month: '十一月', short: '11月', range: [105, 108], year: 3 },
    { month: '十二月', short: '12月', range: [109, 112], year: 3 },
    { month: '一月',   short: '1月',  range: [113, 116], year: 3 },
    { month: '二月',   short: '2月',  range: [117, 120], year: 3 },
    { month: '三月',   short: '3月',  range: [121, 124], year: 3 },
    { month: '四月',   short: '4月',  range: [125, 128], year: 3 },
    { month: '五月',   short: '5月',  range: [129, 132], year: 3 },
    { month: '六月',   short: '6月',  range: [133, 136], year: 3 },
    { month: '七月',   short: '7月',  range: [137, 140], year: 3 }
  ];

  // 学期配置表：{ term: 学期名, range: [startWeek, endWeek] }
  var REAL_TERM_TABLE = [
    // Year 1（高一）
    { term: '第一学期', range: [1,   16] },
    { term: '寒假',     range: [17,  20] },
    { term: '第二学期', range: [21,  40] },
    { term: '暑假',     range: [41,  48] },
    // Year 2（高二）
    { term: '第一学期', range: [49,  64] },
    { term: '寒假',     range: [65,  68] },
    { term: '第二学期', range: [69,  88] },
    { term: '暑假',     range: [89,  96] },
    // Year 3（高三）
    { term: '第一学期', range: [97,  112] },
    { term: '寒假',     range: [113, 116] },
    { term: '第二学期', range: [117, 136] },
    { term: '暑假',     range: [137, 140] }
  ];

  window.RealCalendar = {

    /** 月份配置表 */
    MONTH_TABLE: REAL_MONTH_TABLE,

    /** 学期配置表 */
    TERM_TABLE: REAL_TERM_TABLE,

    /**
     * 根据周数获取月份信息
     * @param {number} week 周数 (1-140)
     * @returns {Object} 月份对象 { month, short, range, year } 或 null
     */
    getMonth: function (week) {
      var w = Math.max(1, Math.min(140, Math.floor(week) || 1));
      for (var i = 0; i < REAL_MONTH_TABLE.length; i++) {
        var m = REAL_MONTH_TABLE[i];
        if (w >= m.range[0] && w <= m.range[1]) {
          return m;
        }
      }
      return REAL_MONTH_TABLE[REAL_MONTH_TABLE.length - 1];
    },

    /**
     * 根据周数获取学期信息
     * @param {number} week 周数 (1-140)
     * @returns {Object} 学期对象 { term, range } 或 null
     */
    getTerm: function (week) {
      var w = Math.max(1, Math.min(140, Math.floor(week) || 1));
      for (var i = 0; i < REAL_TERM_TABLE.length; i++) {
        var t = REAL_TERM_TABLE[i];
        if (w >= t.range[0] && w <= t.range[1]) {
          return t;
        }
      }
      return REAL_TERM_TABLE[REAL_TERM_TABLE.length - 1];
    },

    /**
     * 判断某周是否属于假期（寒假 / 暑假）
     * @param {number} week 周数 (1-140)
     * @returns {boolean}
     */
    isVacation: function (week) {
      var t = this.getTerm(week);
      if (!t) return false;
      return (t.term === '寒假' || t.term === '暑假');
    },

    /**
     * 格式化周数为中文描述，如 "高一9月第2周" 或 "高二3月第4周"
     * @param {number} week 周数 (1-140)
     * @returns {string}
     */
    formatWeek: function (week) {
      var m = this.getMonth(week);
      if (!m) return '第' + week + '周';
      var yearLabel = this.getYearLabel(week);
      var offset = Math.floor(week) - m.range[0] + 1;
      return yearLabel + m.short + '第' + offset + '周';
    },

    /**
     * 获取指定周数的比赛列表
     * @param {number} week 周数 (1-140)
     * @returns {Array} 该周举行的比赛数组
     */
    getContestsAtWeek: function (week) {
      var result = [];
      if (window.REAL_CONTEST_SCHEDULE) {
        for (var i = 0; i < window.REAL_CONTEST_SCHEDULE.length; i++) {
          if (window.REAL_CONTEST_SCHEDULE[i].week === week) {
            result.push(window.REAL_CONTEST_SCHEDULE[i]);
          }
        }
      }
      return result;
    },

    /**
     * 判断某周是否为学期开学周
     * Year 1: weeks 1（第一学期）、21（第二学期）
     * Year 2: weeks 49（第一学期）、69（第二学期）
     * Year 3: weeks 97（第一学期）、117（第二学期）
     * @param {number} week 周数 (1-140)
     * @returns {boolean}
     */
    isTermStart: function (week) {
      return week === 1 || week === 21 || week === 49 || week === 69 || week === 97 || week === 117;
    },

    /**
     * 获取周数所在的学年
     * @param {number} week 周数 (1-140)
     * @returns {number} 1 = 高一, 2 = 高二, 3 = 高三
     */
    getYear: function (week) {
      if (week <= 48) return 1;
      if (week <= 96) return 2;
      return 3;
    },

    /**
     * 获取周数所在的学年标签
     * @param {number} week 周数 (1-140)
     * @returns {string} "高一"/"高二"/"高三"
     */
    getYearLabel: function (week) {
      var y = this.getYear(week);
      var labels = { 1: '高一', 2: '高二', 3: '高三' };
      return labels[y] || '高一';
    },

    /**
     * 获取周数所在的链编号（1 或 2）
     * 链1 = Year 1（weeks 1-48）
     * 链2 = Year 2 + Year 3（weeks 49-144）
     * @param {number} week 周数 (1-140)
     * @returns {number} 1 或 2
     */
    getSeason: function (week) {
      return (week <= 48) ? 1 : 2;
    },

    /**
     * 获取链标签（仅供内部逻辑使用，不在UI显示）
     * @param {number} week 周数 (1-140)
     * @returns {string}
     */
    getSeasonLabel: function (week) {
      return (week <= 48) ? '链1' : '链2';
    }
  };

  /* ========================================================================
   * 第 3 节：比赛日程 — REAL_CONTEST_SCHEDULE
   * -----------------------------------------------------------------------
   * 真实晋级链：CSP-S1 → CSP-S2 → NOIP → 省选 → NOI → CTT → WC → CTS → IOI
   * 每场比赛定义包含完整的元数据，供 UI 展示和模拟器使用。
   * difficultyRange 中的数值遵循原始难度标签体系：
   *   ≤20 入门, ≤50 普及-, ≤86 普及/提高-, ≤103 普及+/提高
   *   ≤120 提高+/省选-, ≤150 省选/NOI-, >150 NOI+/CTSC
   * ======================================================================== */

  // 第二个IOI的周数（用于游戏结束判定）
  window.SECOND_IOI_WEEK = 140;

  window.REAL_CONTEST_SCHEDULE = [
    // ========== 晋级链1 ==========
    // CSP-S1（Y1 Sep W3）
    {
      week: 3,
      id: 'CSP-S1',
      name: 'CSP-S1（第一轮）',
      format: 'OI',
      registrationFee: 100,
      required: true,
      qualificationFrom: null,
      difficultyRange: [20, 85],
      problems: 1,
      duration: 1,
      problemDifficulties: [40],
      problemTypes: [
        { type: '数学' }
      ],
      totalMaxScore: 100,
      rewards: {
        pass:    { reputation: 5, prize: 2000 },
        gold:    { reputation: 15, prize: 3000 },
        silver:  { reputation: 10, prize: 2000 },
        bronze:  { reputation: 7, prize: 1000 }
      },
      cutoffPercents: { '强省': 70, '普通省': 60, '弱省': 50 },
      description: 'CSP 初赛第一轮，入门级难度，全体学生必须参加。'
    },
    // CSP-S2（Y1 Nov W1）
    {
      week: 9,
      id: 'CSP-S2',
      name: 'CSP-S2（第二轮）',
      format: 'OI',
      registrationFee: 100,
      required: true,
      qualificationFrom: 'CSP-S1',
      difficultyRange: [55, 130],
      problems: 4,
      duration: 4,
      problemDifficulties: [55, 75, 100, 130],
      problemTypes: [
        { type: '数学' },
        { type: 'DP', secondary: '数学' },
        { type: '数据结构' },
        { type: '图论', secondary: 'DP' }
      ],
      totalMaxScore: 400,
      rewards: {
        pass:    { reputation: 8, prize: 3000 },
        gold:    { reputation: 25, prize: 5000 },
        silver:  { reputation: 18, prize: 3500 },
        bronze:  { reputation: 12, prize: 2000 }
      },
      cutoffPercents: { '强省': 65, '普通省': 55, '弱省': 45 },
      description: 'CSP 提高级第二轮，需通过 CSP-S1 方可参加。'
    },
    // NOIP（Y1 Nov W4）
    {
      week: 12,
      id: 'NOIP',
      name: 'NOIP（全国联赛）',
      format: 'OI',
      registrationFee: 150,
      required: true,
      qualificationFrom: 'CSP-S2',
      difficultyRange: [70, 170],
      problems: 4,
      duration: 4.5,
      problemDifficulties: [70, 95, 130, 170],
      problemTypes: [
        { type: 'DP', secondary: '数学' },
        { type: '数据结构' },
        { type: '图论', secondary: '数据结构' },
        { type: 'DP', secondary: '字符串' }
      ],
      totalMaxScore: 400,
      rewards: {
        pass:    { reputation: 12, prize: 5000 },
        gold:    { reputation: 40, prize: 10000 },
        silver:  { reputation: 30, prize: 7000 },
        bronze:  { reputation: 20, prize: 5000 }
      },
      cutoffPercents: { '强省': 60, '普通省': 50, '弱省': 40 },
      description: '全国青少年信息学奥林匹克联赛，需通过 CSP-S2。'
    },
    // 省选(1) Y2 Mar W1 = 第 25 周
    {
      week: 25,
      id: '省选',
      name: '省选',
      format: 'SELF_EVAL',
      registrationFee: 200,
      required: false,
      qualificationFrom: 'NOIP',
      difficultyRange: [100, 175],
      problems: 6,
      duration: 5,
      problemDifficulties: [80, 95, 110, 125, 145, 175],
      problemTypes: [
        { type: 'DP', secondary: '图论' },
        { type: '图论', secondary: '数据结构' },
        { type: '数据结构', secondary: 'DP' },
        { type: '字符串', secondary: '数学' },
        { type: '数学', secondary: 'DP' },
        { type: '图论', secondary: '字符串' }
      ],
      totalMaxScore: 600,
      rewards: {
        pass:    { reputation: 18, prize: 5000 },
        gold:    { reputation: 50, prize: 15000 },
        silver:  { reputation: 38, prize: 10000 },
        bronze:  { reputation: 25, prize: 7000 }
      },
      cutoffPercents: { '强省': 70, '普通省': 60, '弱省': 50 },
      description: '省选，Self-eval 赛制可本地评测，需 NOIP 获奖可参加。'
    },
    // NOI(1) Y2 Jul W3 = 第 35 周
    {
      week: 35,
      id: 'NOI',
      name: 'NOI（全国信息学奥林匹克）',
      format: 'SELF_EVAL',
      registrationFee: 500,
      required: false,
      qualificationFrom: '省选',
      difficultyRange: [140, 200],
      problems: 6,
      duration: 5,
      problemDifficulties: [120, 135, 150, 165, 180, 200],
      problemTypes: [
        { type: '数据结构', secondary: 'DP' },
        { type: '图论', secondary: '字符串' },
        { type: 'DP', secondary: '数学', secondary2: '数据结构' },
        { type: '字符串', secondary: '图论' },
        { type: '数学', secondary: '数据结构' },
        { type: '图论', secondary: 'DP' }
      ],
      totalMaxScore: 600,
      rewards: {
        gold:    { reputation: 80, prize: 50000 },
        silver:  { reputation: 60, prize: 30000 },
        bronze:  { reputation: 40, prize: 20000 }
      },
      cutoffPercents: {
        '强省': 80,
        '普通省': 80,
        '弱省': 80
      },
      description: 'NOI 全国决赛，所有省份统一 80% 金牌线，需通过 省选。'
    },
    // CTT(1) Y2 Dec W1 = 第 61 周
    {
      week: 61,
      id: 'CTT',
      name: 'CTT（国家队集训）',
      format: 'IOI',
      registrationFee: 0,
      required: false,
      qualificationFrom: 'NOI',
      difficultyRange: [150, 200],
      problems: 9,
      duration: 10,
      problemDifficulties: [130, 140, 150, 160, 170, 175, 180, 190, 200],
      problemTypes: [
        { type: 'DP', secondary: '数据结构' },
        { type: '图论', secondary: '字符串' },
        { type: '数据结构', secondary: '数学' },
        { type: 'DP', secondary: '图论' },
        { type: '字符串', secondary: 'DP' },
        { type: '数学', secondary: '数据结构' },
        { type: '数据结构', secondary: '字符串' },
        { type: '图论', secondary: '数学' },
        { type: 'DP', secondary: '字符串' }
      ],
      totalMaxScore: 900,
      rewards: {
        pass:    { reputation: 20, prize: 10000 },
        gold:    { reputation: 30, prize: 30000 },
        silver:  { reputation: 20, prize: 20000 },
        bronze:  { reputation: 10, prize: 10000 }
      },
      cutoffPercents: { '强省': 60, '普通省': 60, '弱省': 60 },
      description: 'CTT 国家队集训，IOI 赛制，需 NOI 金牌可参加。'
    },
    // WC(1) Y3 Feb W1 = 第 69 周
    {
      week: 69,
      id: 'WC',
      name: 'WC（全国冬令营）',
      format: 'IOI',
      registrationFee: 200,
      required: false,
      qualificationFrom: 'CTT',
      difficultyRange: [110, 170],
      problems: 3,
      duration: 5,
      problemDifficulties: [110, 140, 170],
      problemTypes: [
        { type: 'DP', secondary: '数据结构' },
        { type: '图论', secondary: '数学' },
        { type: '数据结构', secondary: '字符串' }
      ],
      totalMaxScore: 300,
      rewards: {
        gold:    { reputation: 30, prize: 15000 },
        silver:  { reputation: 22, prize: 10000 },
        bronze:  { reputation: 15, prize: 7000 }
      },
      cutoffPercents: { '强省': 70, '普通省': 60, '弱省': 50 },
      description: '全国信息学冬令营（WC），IOI 赛制，需通过 CTT 可参加。'
    },
    // CTS(1) Y3 Feb W2 = 第 70 周
    {
      week: 70,
      id: 'CTS',
      name: 'CTS（国家队选拔赛）',
      format: 'IOI',
      registrationFee: 0,
      required: false,
      qualificationFrom: 'WC',
      difficultyRange: [155, 205],
      problems: 6,
      duration: 5,
      problemDifficulties: [140, 155, 170, 180, 195, 205],
      problemTypes: [
        { type: '数据结构', secondary: 'DP' },
        { type: '图论', secondary: '数学' },
        { type: 'DP', secondary: '字符串', secondary2: '数据结构' },
        { type: '字符串', secondary: '图论' },
        { type: '数学', secondary: '数据结构' },
        { type: '图论', secondary: 'DP' }
      ],
      totalMaxScore: 600,
      rewards: {
        pass:    { reputation: 30, prize: 15000 },
        gold:    { reputation: 40, prize: 40000 },
        silver:  { reputation: 25, prize: 25000 },
        bronze:  { reputation: 15, prize: 15000 }
      },
      cutoffPercents: { '强省': 70, '普通省': 70, '弱省': 70 },
      description: '国家队选拔赛（CTS），IOI 赛制，需通过 WC 可参加。'
    },
    // IOI(1) Y3 Jul W4 = 第 84 周
    {
      week: 84,
      id: 'IOI',
      name: 'IOI（国际信息学奥林匹克）',
      format: 'IOI',
      registrationFee: 0,
      required: false,
      qualificationFrom: 'CTS',
      isFinalContest: false,
      difficultyRange: [160, 210],
      problems: 6,
      duration: 5,
      problemDifficulties: [145, 160, 175, 185, 200, 210],
      problemTypes: [
        { type: 'DP', secondary: '数据结构' },
        { type: '图论', secondary: '字符串' },
        { type: '数学', secondary: 'DP', secondary2: '图论' },
        { type: '数据结构', secondary: '字符串' },
        { type: '字符串', secondary: 'DP' },
        { type: '图论', secondary: '数学' }
      ],
      totalMaxScore: 600,
      rewards: {
        gold:    { reputation: 150, prize: 100000 },
        silver:  { reputation: 100, prize: 50000 },
        bronze:  { reputation: 60, prize: 30000 }
      },
      cutoffPercents: { '强省': 70, '普通省': 70, '弱省': 70 },
      description: 'IOI 国际信息学奥林匹克，IOI 赛制，需通过 CTS 可参加。'
    },

    // ========== 晋级链2 ==========
    // CSP-S1-S2（Y2 Sep W3）
    {
      week: 51,
      id: 'CSP-S1-S2',
      name: 'CSP-S1（第一轮）',
      format: 'OI',
      registrationFee: 100,
      required: true,
      qualificationFrom: null,
      season: 2,
      difficultyRange: [20, 85],
      problems: 1,
      duration: 1,
      problemDifficulties: [40],
      problemTypes: [
        { type: '数学' }
      ],
      totalMaxScore: 100,
      rewards: {
        pass:    { reputation: 5, prize: 2000 },
        gold:    { reputation: 15, prize: 3000 },
        silver:  { reputation: 10, prize: 2000 },
        bronze:  { reputation: 7, prize: 1000 }
      },
      cutoffPercents: { '强省': 70, '普通省': 60, '弱省': 50 },
      description: 'CSP 初赛第一轮。'
    },
    // CSP-S2-S2（Y2 Nov W1）
    {
      week: 57,
      id: 'CSP-S2-S2',
      name: 'CSP-S2（第二轮）',
      format: 'OI',
      registrationFee: 100,
      required: true,
      qualificationFrom: 'CSP-S1-S2',
      season: 2,
      difficultyRange: [55, 130],
      problems: 4,
      duration: 4,
      problemDifficulties: [55, 75, 100, 130],
      problemTypes: [
        { type: '数学' },
        { type: 'DP', secondary: '数学' },
        { type: '数据结构' },
        { type: '图论', secondary: 'DP' }
      ],
      totalMaxScore: 400,
      rewards: {
        pass:    { reputation: 8, prize: 3000 },
        gold:    { reputation: 25, prize: 5000 },
        silver:  { reputation: 18, prize: 3500 },
        bronze:  { reputation: 12, prize: 2000 }
      },
      cutoffPercents: { '强省': 65, '普通省': 55, '弱省': 45 },
      description: 'CSP 提高级第二轮。'
    },
    // NOIP-S2（Y2 Nov W4）
    {
      week: 60,
      id: 'NOIP-S2',
      name: 'NOIP（全国联赛）',
      format: 'OI',
      registrationFee: 150,
      required: true,
      qualificationFrom: 'CSP-S2-S2',
      season: 2,
      difficultyRange: [70, 170],
      problems: 4,
      duration: 4.5,
      problemDifficulties: [70, 95, 130, 170],
      problemTypes: [
        { type: 'DP', secondary: '数学' },
        { type: '数据结构' },
        { type: '图论', secondary: '数据结构' },
        { type: 'DP', secondary: '字符串' }
      ],
      totalMaxScore: 400,
      rewards: {
        pass:    { reputation: 12, prize: 5000 },
        gold:    { reputation: 40, prize: 10000 },
        silver:  { reputation: 30, prize: 7000 },
        bronze:  { reputation: 20, prize: 5000 }
      },
      cutoffPercents: { '强省': 60, '普通省': 50, '弱省': 40 },
      description: 'NOIP 全国联赛。'
    },
    // 省选(2) Y3 Mar W1 = 第 73 周
    {
      week: 73,
      id: '省选-S2',
      name: '省选',
      format: 'SELF_EVAL',
      registrationFee: 200,
      required: false,
      qualificationFrom: 'NOIP-S2',
      season: 2,
      difficultyRange: [100, 175],
      problems: 6,
      duration: 5,
      problemDifficulties: [80, 95, 110, 125, 145, 175],
      problemTypes: [
        { type: 'DP', secondary: '图论' },
        { type: '图论', secondary: '数据结构' },
        { type: '数据结构', secondary: 'DP' },
        { type: '字符串', secondary: '数学' },
        { type: '数学', secondary: 'DP' },
        { type: '图论', secondary: '字符串' }
      ],
      totalMaxScore: 600,
      rewards: {
        pass:    { reputation: 18, prize: 5000 },
        gold:    { reputation: 50, prize: 15000 },
        silver:  { reputation: 38, prize: 10000 },
        bronze:  { reputation: 25, prize: 7000 }
      },
      cutoffPercents: { '强省': 70, '普通省': 60, '弱省': 50 },
      description: '省选，Self-eval 赛制可本地评测，需 NOIP 获奖可参加。'
    },
    // NOI(2) Y3 Jul W3 = 第 83 周
    {
      week: 83,
      id: 'NOI-S2',
      name: 'NOI（全国信息学奥林匹克）',
      format: 'SELF_EVAL',
      registrationFee: 500,
      required: false,
      qualificationFrom: '省选-S2',
      season: 2,
      difficultyRange: [140, 200],
      problems: 6,
      duration: 5,
      problemDifficulties: [120, 135, 150, 165, 180, 200],
      problemTypes: [
        { type: '数据结构', secondary: 'DP' },
        { type: '图论', secondary: '字符串' },
        { type: 'DP', secondary: '数学', secondary2: '数据结构' },
        { type: '字符串', secondary: '图论' },
        { type: '数学', secondary: '数据结构' },
        { type: '图论', secondary: 'DP' }
      ],
      totalMaxScore: 600,
      rewards: {
        gold:    { reputation: 80, prize: 50000 },
        silver:  { reputation: 60, prize: 30000 },
        bronze:  { reputation: 40, prize: 20000 }
      },
      cutoffPercents: {
        '强省': 80,
        '普通省': 80,
        '弱省': 80
      },
      description: 'NOI 全国决赛，所有省份统一 80% 金牌线，需通过 省选。'
    },
    // CTT(2) Y3 Dec W1 = 第 97 周
    {
      week: 97,
      id: 'CTT-S2',
      name: 'CTT（国家队集训）',
      format: 'IOI',
      registrationFee: 0,
      required: false,
      qualificationFrom: 'NOI-S2',
      season: 2,
      difficultyRange: [150, 200],
      problems: 9,
      duration: 10,
      problemDifficulties: [130, 140, 150, 160, 170, 175, 180, 190, 200],
      problemTypes: [
        { type: 'DP', secondary: '数据结构' },
        { type: '图论', secondary: '字符串' },
        { type: '数据结构', secondary: '数学' },
        { type: 'DP', secondary: '图论' },
        { type: '字符串', secondary: 'DP' },
        { type: '数学', secondary: '数据结构' },
        { type: '数据结构', secondary: '字符串' },
        { type: '图论', secondary: '数学' },
        { type: 'DP', secondary: '字符串' }
      ],
      totalMaxScore: 900,
      rewards: {
        pass:    { reputation: 20, prize: 10000 },
        gold:    { reputation: 30, prize: 30000 },
        silver:  { reputation: 20, prize: 20000 },
        bronze:  { reputation: 10, prize: 10000 }
      },
      cutoffPercents: { '强省': 60, '普通省': 60, '弱省': 60 },
      description: 'CTT 国家队集训，IOI 赛制，需 NOI 金牌可参加。'
    },
    // WC(2) Y4 Feb W1 = 第 105 周
    {
      week: 105,
      id: 'WC-S2',
      name: 'WC（全国冬令营）',
      format: 'IOI',
      registrationFee: 200,
      required: false,
      qualificationFrom: 'CTT-S2',
      season: 2,
      difficultyRange: [110, 170],
      problems: 3,
      duration: 5,
      problemDifficulties: [110, 140, 170],
      problemTypes: [
        { type: 'DP', secondary: '数据结构' },
        { type: '图论', secondary: '数学' },
        { type: '数据结构', secondary: '字符串' }
      ],
      totalMaxScore: 300,
      rewards: {
        gold:    { reputation: 30, prize: 15000 },
        silver:  { reputation: 22, prize: 10000 },
        bronze:  { reputation: 15, prize: 7000 }
      },
      cutoffPercents: { '强省': 70, '普通省': 60, '弱省': 50 },
      description: 'WC 全国信息学冬令营，IOI 赛制，需通过 CTT 可参加。'
    },
    // CTS(2) Y4 Feb W2 = 第 106 周
    {
      week: 106,
      id: 'CTS-S2',
      name: 'CTS（国家队选拔赛）',
      format: 'IOI',
      registrationFee: 0,
      required: false,
      qualificationFrom: 'WC-S2',
      season: 2,
      difficultyRange: [155, 205],
      problems: 6,
      duration: 5,
      problemDifficulties: [140, 155, 170, 180, 195, 205],
      problemTypes: [
        { type: '数据结构', secondary: 'DP' },
        { type: '图论', secondary: '数学' },
        { type: 'DP', secondary: '字符串', secondary2: '数据结构' },
        { type: '字符串', secondary: '图论' },
        { type: '数学', secondary: '数据结构' },
        { type: '图论', secondary: 'DP' }
      ],
      totalMaxScore: 600,
      rewards: {
        pass:    { reputation: 30, prize: 15000 },
        gold:    { reputation: 40, prize: 40000 },
        silver:  { reputation: 25, prize: 25000 },
        bronze:  { reputation: 15, prize: 15000 }
      },
      cutoffPercents: { '强省': 70, '普通省': 70, '弱省': 70 },
      description: 'CTS 国家队选拔赛，IOI 赛制，需通过 WC 可参加。'
    },
    // IOI(2) Y4 Jul W4 = 第 140 周 — 完成后游戏立刻结束
    {
      week: 140,
      id: 'IOI-S2',
      name: 'IOI（国际信息学奥林匹克）',
      format: 'IOI',
      registrationFee: 0,
      required: false,
      qualificationFrom: 'CTS-S2',
      isFinalContest: true,
      season: 2,
      difficultyRange: [160, 210],
      problems: 6,
      duration: 5,
      problemDifficulties: [145, 160, 175, 185, 200, 210],
      problemTypes: [
        { type: 'DP', secondary: '数据结构' },
        { type: '图论', secondary: '字符串' },
        { type: '数学', secondary: 'DP', secondary2: '图论' },
        { type: '数据结构', secondary: '字符串' },
        { type: '字符串', secondary: 'DP' },
        { type: '图论', secondary: '数学' }
      ],
      totalMaxScore: 600,
      rewards: {
        gold:    { reputation: 150, prize: 100000 },
        silver:  { reputation: 100, prize: 50000 },
        bronze:  { reputation: 60, prize: 30000 }
      },
      cutoffPercents: { '强省': 70, '普通省': 70, '弱省': 70 },
      description: 'IOI 国际信息学奥林匹克，IOI 赛制 — 完成本赛后游戏立刻结束！'
    }
  ];

  /* ========================================================================
   * 第 4 节：比赛赛制定义 — CONTEST_FORMATS
   * -----------------------------------------------------------------------
   * OI:        传统 OI 赛制，提交后有失分概率（subtask 评测）
   * SELF_EVAL: 自测赛制，可本地评测（2 轮），无提交失分
   * IOI:       IOI 赛制，实时反馈，无失分
   * ACM:       ACM 赛制，三人组队，实时反馈
   * ======================================================================== */

  window.CONTEST_FORMATS = {
    OI: {
      id: 'OI',
      hasScoreLoss: true,
      feedbackMode: 'delayed',
      scoreLossBaseRate: 0.05,
      description: '传统OI赛制，提交后延迟公布成绩，存在一定失分概率'
    },
    SELF_EVAL: {
      id: 'SELF_EVAL',
      hasScoreLoss: false,
      feedbackMode: 'local',
      localTestRounds: 2,
      description: 'Self-eval赛制，可本地评测，无提交失分'
    },
    IOI: {
      id: 'IOI',
      hasScoreLoss: false,
      feedbackMode: 'realtime',
      description: 'IOI赛制，实时反馈，无提交失分'
    },
    ACM: {
      id: 'ACM',
      hasScoreLoss: false,
      feedbackMode: 'realtime',
      teamSize: 3,
      description: 'ACM赛制，三人组队，实时反馈'
    }
  };

  /* ========================================================================
   * 第 5 节：难度标签映射 — DIFFICULTY_LABELS
   * -----------------------------------------------------------------------
   * 与原始 constants.js 中的难度体系一致。
   * 难度值越小越简单，越大越难。
   * ======================================================================== */

  window.DIFFICULTY_LABELS = [
    { max: 20,       label: '入门',       color: '#e74c3c', cls: 'diff-red'    },
    { max: 50,       label: '普及-',      color: '#e67e22', cls: 'diff-orange' },
    { max: 86,       label: '普及/提高-', color: '#f1c40f', cls: 'diff-yellow' },
    { max: 103,      label: '普及+/提高', color: '#2ecc71', cls: 'diff-green'  },
    { max: 120,      label: '提高+/省选-',color: '#3498db', cls: 'diff-blue'   },
    { max: 150,      label: '省选/NOI-',  color: '#9b59b6', cls: 'diff-purple' },
    { max: Infinity, label: 'NOI+/CTSC',  color: '#2c3e50', cls: 'diff-black'  }
  ];

  /**
   * 根据难度值获取对应的标签信息
   * @param {number} diff 难度数值
   * @returns {Object} { max, label, color, cls }
   */
  window.getDifficultyLabel = function (diff) {
    var d = Number(diff) || 0;
    for (var i = 0; i < window.DIFFICULTY_LABELS.length; i++) {
      if (d <= window.DIFFICULTY_LABELS[i].max) {
        return window.DIFFICULTY_LABELS[i];
      }
    }
    return window.DIFFICULTY_LABELS[window.DIFFICULTY_LABELS.length - 1];
  };

  /* ========================================================================
   * 第 6 节：知识点定义
   * -----------------------------------------------------------------------
   * Real Mode 使用 5 大知识点分类，与原始 talent.js 中使用的
   * knowledge_ds / knowledge_graph / knowledge_string / knowledge_math / knowledge_dp
   * 保持一致。
   * ======================================================================== */

  window.KNOWLEDGE_POINTS = ['数据结构', '图论', '字符串', '数学', 'DP'];

  window.KNOWLEDGE_MAP = {
    '数据结构': 'knowledge_ds',
    '图论':     'knowledge_graph',
    '字符串':   'knowledge_string',
    '数学':     'knowledge_math',
    'DP':       'knowledge_dp'
  };

  /** 知识点中文名 → 英文键的反向映射（便于 UI 交互） */
  window.KNOWLEDGE_MAP_REVERSE = {
    'knowledge_ds':      '数据结构',
    'knowledge_graph':   '图论',
    'knowledge_string':  '字符串',
    'knowledge_math':    '数学',
    'knowledge_dp':      'DP'
  };

  /**
   * 根据知识点英文名获取中文名
   * @param {string} key 英文键，如 'knowledge_ds'
   * @returns {string} 中文名
   */
  window.getKnowledgeName = function (key) {
    return window.KNOWLEDGE_MAP_REVERSE[key] || key;
  };

  /**
   * 根据知识点中文名获取英文名
   * @param {string} name 中文名
   * @returns {string} 英文键
   */
  window.getKnowledgeKey = function (name) {
    return window.KNOWLEDGE_MAP[name] || name;
  };

  /* ========================================================================
   * 第 7 节：训练任务池 — REAL_TASK_POOL
   * -----------------------------------------------------------------------
   * 包含约 100 个训练任务，覆盖 5 大知识点领域和从入门到 NOI+ 的难度范围。
   * 每个任务包含：
   *   name: 任务名称
   *   difficulty: 难度值 (1-200)
   *   boosts: [{ type: 知识点中文名, amount: 增益量 }]
   *
   * 每个知识点领域至少 20 个任务。
   * ======================================================================== */

  window.REAL_TASK_POOL = [

    // ==================== 第 1 难度：入门 (difficulty ≤ 20) — 主 boost 2-3 ====================

    // --- 入门 · 数据结构 (3) ---
    { name: 'P1428 小鱼比可爱',              difficulty: 5,   boosts: [{ type: '数据结构', amount: 2 }] },
    { name: 'P5268 简单排序',                difficulty: 12,  boosts: [{ type: '数据结构', amount: 2 }, { type: '数学', amount: 1 }] },
    { name: 'P1046 陶陶摘苹果',              difficulty: 18,  boosts: [{ type: '数据结构', amount: 3 }] },

    // --- 入门 · 图论 (3) ---
    { name: 'P1119 灾后重建',                difficulty: 5,   boosts: [{ type: '图论', amount: 2 }] },
    { name: 'P1113 杂务',                   difficulty: 12,  boosts: [{ type: '图论', amount: 2 }, { type: '数据结构', amount: 1 }] },
    { name: 'P1175 志愿者招募',              difficulty: 18,  boosts: [{ type: '图论', amount: 3 }] },

    // --- 入门 · 字符串 (3) ---
    { name: 'P1205 字符串变换',               difficulty: 3,   boosts: [{ type: '字符串', amount: 2 }] },
    { name: 'P1706 字符串统计',               difficulty: 10,  boosts: [{ type: '字符串', amount: 2 }] },
    { name: 'P3375 KMP字符串匹配',            difficulty: 18,  boosts: [{ type: '字符串', amount: 3 }, { type: '数学', amount: 1 }] },

    // --- 入门 · 数学 (3) ---
    { name: 'P3383 线性筛素数',              difficulty: 5,   boosts: [{ type: '数学', amount: 2 }] },
    { name: 'P1029 最大公约数',              difficulty: 10,  boosts: [{ type: '数学', amount: 3 }] },
    { name: 'P1226 快速幂取余',              difficulty: 15,  boosts: [{ type: '数学', amount: 3 }, { type: 'DP', amount: 1 }] },

    // --- 入门 · DP (3) ---
    { name: 'P1255 数楼梯',                  difficulty: 3,   boosts: [{ type: 'DP', amount: 2 }] },
    { name: 'P1020 导弹拦截',                difficulty: 10,  boosts: [{ type: 'DP', amount: 3 }, { type: '数学', amount: 1 }] },
    { name: 'P1048 采药',                   difficulty: 18,  boosts: [{ type: 'DP', amount: 3 }] },

    // ==================== 第 2 难度：普及- (difficulty 21-50) — 主 boost 3-4 ====================

    // --- 普及- · 数据结构 (3) ---
    { name: 'P2249 查找',                   difficulty: 25,  boosts: [{ type: '数据结构', amount: 4 }, { type: '数学', amount: 1 }] },
    { name: 'P1090 合并果子',                difficulty: 35,  boosts: [{ type: '数据结构', amount: 4 }] },
    { name: 'P1177 快速排序',                difficulty: 42,  boosts: [{ type: '数据结构', amount: 3 }, { type: '数学', amount: 1 }] },

    // --- 普及- · 图论 (3) ---
    { name: 'P4779 单源最短路径',            difficulty: 25,  boosts: [{ type: '图论', amount: 3 }] },
    { name: 'P3385 负环',                   difficulty: 32,  boosts: [{ type: '图论', amount: 4 }] },
    { name: 'P3386 二分图匹配',              difficulty: 45,  boosts: [{ type: '图论', amount: 4 }, { type: '数据结构', amount: 1 }] },

    // --- 普及- · 字符串 (3) ---
    { name: 'P8306 字典树',                  difficulty: 25,  boosts: [{ type: '字符串', amount: 3 }, { type: '数据结构', amount: 2 }] },
    { name: 'P5410 扩展KMP',                difficulty: 35,  boosts: [{ type: '字符串', amount: 4 }] },
    { name: 'P3805 Manacher回文串',          difficulty: 48,  boosts: [{ type: '字符串', amount: 3 }, { type: '数学', amount: 1 }] },

    // --- 普及- · 数学 (3) ---
    { name: 'P1313 计算系数',                difficulty: 28,  boosts: [{ type: '数学', amount: 4 }] },
    { name: 'P1082 同余方程',                difficulty: 38,  boosts: [{ type: '数学', amount: 3 }, { type: '字符串', amount: 1 }] },
    { name: 'P1349 矩阵快速幂',              difficulty: 45,  boosts: [{ type: '数学', amount: 4 }, { type: 'DP', amount: 2 }] },

    // --- 普及- · DP (3) ---
    { name: 'P1616 疯狂的采药',               difficulty: 28,  boosts: [{ type: 'DP', amount: 3 }] },
    { name: 'P1880 石子合并',                difficulty: 38,  boosts: [{ type: 'DP', amount: 4 }, { type: '数学', amount: 1 }] },
    { name: 'P2015 二叉苹果树',               difficulty: 48,  boosts: [{ type: 'DP', amount: 4 }, { type: '图论', amount: 2 }] },

    // ==================== 第 3 难度：普及/提高- (difficulty 51-86) — 主 boost 4-5 ====================

    // --- 普及/提高- · 数据结构 (3) ---
    { name: 'P3372 线段树1',                difficulty: 55,  boosts: [{ type: '数据结构', amount: 5 }] },
    { name: 'P3374 树状数组1',               difficulty: 65,  boosts: [{ type: '数据结构', amount: 5 }, { type: '数学', amount: 2 }] },
    { name: 'P1886 滑动窗口',                difficulty: 78,  boosts: [{ type: '数据结构', amount: 4 }, { type: '图论', amount: 2 }] },

    // --- 普及/提高- · 图论 (3) ---
    { name: 'P3387 缩点',                   difficulty: 55,  boosts: [{ type: '图论', amount: 5 }] },
    { name: 'P3275 糖果',                   difficulty: 65,  boosts: [{ type: '图论', amount: 5 }, { type: '数学', amount: 2 }] },
    { name: 'P3376 网络最大流',              difficulty: 80,  boosts: [{ type: '图论', amount: 5 }, { type: '数据结构', amount: 2 }] },

    // --- 普及/提高- · 字符串 (3) ---
    { name: 'P3796 AC自动机',                difficulty: 55,  boosts: [{ type: '字符串', amount: 5 }, { type: '数据结构', amount: 2 }] },
    { name: 'P4051 字符串哈希',              difficulty: 68,  boosts: [{ type: '字符串', amount: 5 }, { type: '数学', amount: 3 }] },
    { name: 'P3804 后缀自动机',              difficulty: 82,  boosts: [{ type: '字符串', amount: 5 }] },

    // --- 普及/提高- · 数学 (3) ---
    { name: 'P1495 曹冲养猪',                difficulty: 55,  boosts: [{ type: '数学', amount: 5 }] },
    { name: 'P2158 仪仗队',                  difficulty: 68,  boosts: [{ type: '数学', amount: 4 }, { type: '图论', amount: 2 }] },
    { name: 'P2522 莫比乌斯反演',             difficulty: 80,  boosts: [{ type: '数学', amount: 5 }, { type: 'DP', amount: 2 }] },

    // --- 普及/提高- · DP (3) ---
    { name: 'P1879 玉米田',                  difficulty: 55,  boosts: [{ type: 'DP', amount: 5 }, { type: '数学', amount: 2 }] },
    { name: 'P2704 炮兵阵地',                difficulty: 68,  boosts: [{ type: 'DP', amount: 4 }] },
    { name: 'P2014 选课',                   difficulty: 82,  boosts: [{ type: 'DP', amount: 5 }, { type: '图论', amount: 2 }] },

    // ==================== 第 4 难度：普及+/提高 (difficulty 87-103) — 主 boost 5-6 ====================

    // --- 普及+/提高 · 数据结构 (3) ---
    { name: 'P3369 普通平衡树',              difficulty: 90,  boosts: [{ type: '数据结构', amount: 6 }] },
    { name: 'P3383 线段树2',                difficulty: 98,  boosts: [{ type: '数据结构', amount: 6 }, { type: '数学', amount: 2 }] },
    { name: 'P3377 左偏树',                  difficulty: 102, boosts: [{ type: '数据结构', amount: 5 }, { type: '图论', amount: 2 }] },

    // --- 普及+/提高 · 图论 (3) ---
    { name: 'P3376D 最小割',                 difficulty: 90,  boosts: [{ type: '图论', amount: 6 }, { type: '数学', amount: 2 }] },
    { name: 'P3381 最小费用最大流',            difficulty: 98,  boosts: [{ type: '图论', amount: 5 }] },
    { name: 'P4779B 最短路计数',              difficulty: 102, boosts: [{ type: '图论', amount: 6 }, { type: 'DP', amount: 2 }] },

    // --- 普及+/提高 · 字符串 (3) ---
    { name: 'P3370 字符串哈希进阶',           difficulty: 88,  boosts: [{ type: '字符串', amount: 5 }, { type: '数学', amount: 3 }] },
    { name: 'P4161 后缀数组基础',             difficulty: 95,  boosts: [{ type: '字符串', amount: 6 }, { type: '数学', amount: 2 }] },
    { name: 'P5357 AC自动机2',               difficulty: 100, boosts: [{ type: '字符串', amount: 6 }, { type: '数据结构', amount: 2 }] },

    // --- 普及+/提高 · 数学 (3) ---
    { name: 'P3803 FFT',                    difficulty: 90,  boosts: [{ type: '数学', amount: 5 }] },
    { name: 'P1919 FFT加速多项式',           difficulty: 98,  boosts: [{ type: '数学', amount: 6 }] },
    { name: 'P2000 生成函数',                difficulty: 102, boosts: [{ type: '数学', amount: 6 }, { type: 'DP', amount: 3 }] },

    // --- 普及+/提高 · DP (3) ---
    { name: 'P3628 [APIO2010]特别行动队',     difficulty: 88,  boosts: [{ type: 'DP', amount: 6 }, { type: '数学', amount: 3 }] },
    { name: 'P1654 OSU!',                   difficulty: 95,  boosts: [{ type: 'DP', amount: 5 }, { type: '数学', amount: 2 }] },
    { name: 'P3416 观光旅行',                difficulty: 100, boosts: [{ type: 'DP', amount: 6 }, { type: '图论', amount: 3 }] },

    // ==================== 第 5 难度：提高+/省选- (difficulty 104-120) — 主 boost 6-7 ====================

    // --- 提高+/省选- · 数据结构 (3) ---
    { name: 'P4357 四维偏序',                difficulty: 108, boosts: [{ type: '数据结构', amount: 7 }] },
    { name: 'P3690 LCT模板',                difficulty: 115, boosts: [{ type: '数据结构', amount: 7 }, { type: '图论', amount: 2 }] },
    { name: 'P3384 树链剖分',                difficulty: 118, boosts: [{ type: '数据结构', amount: 6 }, { type: '图论', amount: 3 }] },

    // --- 提高+/省选- · 图论 (3) ---
    { name: 'P6175 无向图最小斯坦纳树',        difficulty: 108, boosts: [{ type: '图论', amount: 7 }, { type: 'DP', amount: 3 }, { type: '数据结构', amount: 2 }] },
    { name: 'P3386B 二分图最大匹配',          difficulty: 112, boosts: [{ type: '图论', amount: 6 }, { type: '数据结构', amount: 2 }] },
    { name: 'P2774 方格取数问题',             difficulty: 118, boosts: [{ type: '图论', amount: 7 }] },

    // --- 提高+/省选- · 字符串 (3) ---
    { name: 'P3804B SAM性质与应用',           difficulty: 105, boosts: [{ type: '字符串', amount: 6 }] },
    { name: 'P4287 回文自动机',              difficulty: 112, boosts: [{ type: '字符串', amount: 7 }, { type: '数据结构', amount: 3 }] },
    { name: 'P1117 Lyndon分解',             difficulty: 118, boosts: [{ type: '字符串', amount: 7 }, { type: '数学', amount: 3 }] },

    // --- 提高+/省选- · 数学 (3) ---
    { name: 'P4980 Polya定理',               difficulty: 108, boosts: [{ type: '数学', amount: 6 }] },
    { name: 'P4301 异或线性基',               difficulty: 112, boosts: [{ type: '数学', amount: 7 }, { type: '数据结构', amount: 2 }] },
    { name: 'P2197 Nim游戏',                 difficulty: 118, boosts: [{ type: '数学', amount: 7 }, { type: '图论', amount: 3 }] },

    // --- 提高+/省选- · DP (3) ---
    { name: 'P5056 插头DP',                  difficulty: 105, boosts: [{ type: 'DP', amount: 7 }, { type: '数据结构', amount: 3 }] },
    { name: 'P2602B 数字计数进阶',           difficulty: 112, boosts: [{ type: 'DP', amount: 6 }, { type: '数学', amount: 4 }] },
    { name: 'P1113B DAG最长路',              difficulty: 118, boosts: [{ type: 'DP', amount: 7 }, { type: '图论', amount: 3 }] },

    // ==================== 第 6 难度：省选/NOI- (difficulty 121-150) — 主 boost 7-9 ====================

    // --- 省选/NOI- · 数据结构 (3) ---
    { name: 'P4137 区间众数',                difficulty: 125, boosts: [{ type: '数据结构', amount: 8 }, { type: '数学', amount: 3 }] },
    { name: 'P3834 可持久化线段树',           difficulty: 135, boosts: [{ type: '数据结构', amount: 8 }, { type: '数学', amount: 2 }] },
    { name: 'P5283 [十二省联考]异或粽子',    difficulty: 145, boosts: [{ type: '数据结构', amount: 9 }, { type: '数学', amount: 3 }] },

    // --- 省选/NOI- · 图论 (3) ---
    { name: 'P2495 虚树',                   difficulty: 128, boosts: [{ type: '图论', amount: 8 }, { type: '数据结构', amount: 3 }] },
    { name: 'P5304 GXOI/GZOI 圆方树',      difficulty: 140, boosts: [{ type: '图论', amount: 9 }, { type: '数据结构', amount: 3 }] },
    { name: 'P3379 最近公共祖先',             difficulty: 148, boosts: [{ type: '图论', amount: 8 }, { type: '数据结构', amount: 4 }] },

    // --- 省选/NOI- · 字符串 (3) ---
    { name: 'P1368 最小表示法',              difficulty: 125, boosts: [{ type: '字符串', amount: 7 }, { type: '数学', amount: 3 }] },
    { name: 'P3803B 后缀数组进阶',           difficulty: 138, boosts: [{ type: '字符串', amount: 8 }, { type: '数据结构', amount: 4 }] },
    { name: 'P4172 FFT字符串匹配',           difficulty: 145, boosts: [{ type: '字符串', amount: 8 }, { type: '数学', amount: 5 }] },

    // --- 省选/NOI- · 数学 (3) ---
    { name: 'P4238 多项式求逆',              difficulty: 130,  boosts: [{ type: '数学', amount: 9 }] },
    { name: 'P5395 第二类斯特林数',            difficulty: 142, boosts: [{ type: '数学', amount: 9 }, { type: 'DP', amount: 3 }] },
    { name: 'P5491 [模板]多项式ln',          difficulty: 148, boosts: [{ type: '数学', amount: 8 }, { type: '数据结构', amount: 2 }] },

    // --- 省选/NOI- · DP (3) ---
    { name: 'P4956 优雅地丢',                difficulty: 125, boosts: [{ type: 'DP', amount: 8 }, { type: '数学', amount: 3 }] },
    { name: 'P4767 IOI2000 邮局',           difficulty: 138, boosts: [{ type: 'DP', amount: 8 }, { type: '数学', amount: 4 }] },
    { name: 'P4983 忘情',                   difficulty: 148, boosts: [{ type: 'DP', amount: 9 }, { type: '数学', amount: 4 }] },

    // ==================== 第 7 难度：NOI+/CTSC (difficulty > 150) — 主 boost 9-10 ====================

    // --- NOI+/CTSC · 数据结构 (3) ---
    { name: 'P4149 国际象棋',                difficulty: 155, boosts: [{ type: '数据结构', amount: 9 }, { type: '图论', amount: 3 }] },
    { name: 'P3380 二逼平衡树',              difficulty: 165, boosts: [{ type: '数据结构', amount: 10 }, { type: 'DP', amount: 3 }] },
    { name: 'P4135 回滚莫队',                difficulty: 175, boosts: [{ type: '数据结构', amount: 10 }, { type: '数学', amount: 3 }] },

    // --- NOI+/CTSC · 图论 (3) ---
    { name: 'P5291 支配树',                  difficulty: 158, boosts: [{ type: '图论', amount: 9 }, { type: '数据结构', amount: 4 }] },
    { name: 'P5903 [模板]动态树分治',         difficulty: 170, boosts: [{ type: '图论', amount: 10 }, { type: '数据结构', amount: 4 }] },
    { name: 'P5864 [NOI2014]随机数生成器',     difficulty: 185, boosts: [{ type: '图论', amount: 10 }, { type: '数学', amount: 4 }] },

    // --- NOI+/CTSC · 字符串 (3) ---
    { name: 'P5829 序列自动机',               difficulty: 155, boosts: [{ type: '字符串', amount: 8 }, { type: 'DP', amount: 4 }] },
    { name: 'P5830 高级字符串综合',             difficulty: 170, boosts: [{ type: '字符串', amount: 10 }, { type: '数学', amount: 4 }, { type: '数据结构', amount: 3 }] },
    { name: 'P6634 [ZJOI2020]字符串',        difficulty: 190, boosts: [{ type: '字符串', amount: 10 }, { type: 'DP', amount: 3 }] },

    // --- NOI+/CTSC · 数学 (3) ---
    { name: 'P5325 Min_25筛',               difficulty: 158, boosts: [{ type: '数学', amount: 10 }, { type: '数据结构', amount: 4 }] },
    { name: 'P5285 [十二省联考]异或传染',      difficulty: 170, boosts: [{ type: '数学', amount: 9 }, { type: '字符串', amount: 3 }] },
    { name: 'P5289 [十二省联考]皮配',         difficulty: 190, boosts: [{ type: '数学', amount: 10 }, { type: 'DP', amount: 4 }] },

    // --- NOI+/CTSC · DP (3) ---
    { name: 'P4158 粉刷匠',                  difficulty: 155, boosts: [{ type: 'DP', amount: 9 }, { type: '数据结构', amount: 4 }, { type: '数学', amount: 3 }] },
    { name: 'P4137B 终于结束的起点',           difficulty: 172, boosts: [{ type: 'DP', amount: 10 }, { type: '数学', amount: 4 }, { type: '图论', amount: 3 }] },
    { name: 'P5832 [NOI2021]庆典',           difficulty: 195, boosts: [{ type: 'DP', amount: 10 }, { type: '图论', amount: 4 }, { type: '数据结构', amount: 3 }] }
  ];

  /* ========================================================================
   * 第 8 节：省份数据辅助函数
   * -----------------------------------------------------------------------
   * 原始 constants.js 中已定义 window.PROVINCES，这里仅添加辅助函数。
   * ======================================================================== */

  /**
   * 根据省份序号获取省份对象
   * @param {number} idx 省份序号 (1-33)
   * @returns {Object|null} 省份对象或 null
   */
  window.getProvinceByIndex = function (idx) {
    if (typeof PROVINCES === 'undefined') return null;
    var n = Number(idx);
    if (!isFinite(n) || n < 1) return null;
    return PROVINCES[n] || null;
  };

  /**
   * 获取所有省份列表（数组形式）
   * @returns {Array} 省份对象数组
   */
  window.getAllProvinces = function () {
    var result = [];
    if (typeof PROVINCES === 'undefined') return result;
    for (var k in PROVINCES) {
      if (PROVINCES.hasOwnProperty(k)) {
        result.push({ index: Number(k), data: PROVINCES[k] });
      }
    }
    return result;
  };

  /**
   * 按省份类型分组获取省份
   * @param {string} type 省份类型：'强省' | '普通省' | '弱省'
   * @returns {Array} 省份对象数组
   */
  window.getProvincesByType = function (type) {
    var result = [];
    if (typeof PROVINCES === 'undefined') return result;
    for (var k in PROVINCES) {
      if (PROVINCES.hasOwnProperty(k) && PROVINCES[k].type === type) {
        result.push({ index: Number(k), data: PROVINCES[k] });
      }
    }
    return result;
  };

  /* ========================================================================
   * 第 9 节：行动定义 — REAL_ACTIONS
   * -----------------------------------------------------------------------
   * Real Mode 中学生每周可执行的动作。
   * type: 动作类型 (training/camp/academic/exercise/rest/entertainment)
   * cost: 经费消耗
   * staminaCost: 体力消耗
   * pressureChange: 压力变化（正数增加压力，负数减少压力）
   * description: 中文描述
   * ======================================================================== */

  window.REAL_ACTIONS = {

    '做题训练': {
      type: 'training',
      cost: 0,
      staminaCost: 10,
      pressureChange: 5,
      description: '选择题目进行训练，消耗体力并增加压力，可提升知识和能力'
    },

    '高强度训练': {
      type: 'training',
      cost: 500,
      staminaCost: 20,
      pressureChange: 12,
      description: '高强度训练，知识获取更多，但体力消耗和压力增加更大'
    },

    '集训': {
      type: 'camp',
      cost: 0,
      staminaCost: 25,
      pressureChange: 8,
      description: '集训，大量消耗体力但获取较多经验，适合赛前冲刺（每人¥1,000）'
    },

    '修习文化课': {
      type: 'academic',
      cost: 0,
      staminaCost: 0,
      pressureChange: -3,
      academicGain: 8,
      description: '学习文化课知识，不消耗体力，轻微降低压力'
    },

    '运动': {
      type: 'exercise',
      cost: 0,
      staminaCost: 5,
      pressureChange: -15,
      description: '运动锻炼，有效缓解压力，少量消耗体力'
    },

    '休息': {
      type: 'rest',
      cost: 0,
      staminaCost: 0,
      pressureChange: -8,
      description: '休息恢复，降低压力，不消耗体力也不消耗经费'
    },

    '娱乐': {
      type: 'entertainment',
      cost: 0,
      staminaCost: 0,
      pressureChange: -20,
      knowledgeLoss: 1,
      description: '娱乐放松，大幅降低压力，但会导致少量知识遗忘'
    },

    '研学': {
      type: 'outing',
      cost: 0,           // 动态计算（基于难度、省份、人数、声誉）
      staminaCost: 25,
      pressureChange: 0,  // 动态计算（基于难度、是否不匹配）
      description: '外出研学，选择难度和省份，全面提升知识和能力，可激发天赋'
    }
  };

  /**
   * 获取所有行动名称列表
   * @returns {Array} 行动名称数组
   */
  window.getRealActionNames = function () {
    var result = [];
    if (window.REAL_ACTIONS) {
      for (var k in window.REAL_ACTIONS) {
        if (window.REAL_ACTIONS.hasOwnProperty(k)) {
          result.push(k);
        }
      }
    }
    return result;
  };

  /**
   * 根据类型获取行动列表
   * @param {string} type 动作类型
   * @returns {Array} 匹配的行动对象数组
   */
  window.getRealActionsByType = function (type) {
    var result = [];
    if (!window.REAL_ACTIONS) return result;
    for (var k in window.REAL_ACTIONS) {
      if (window.REAL_ACTIONS.hasOwnProperty(k) && window.REAL_ACTIONS[k].type === type) {
        result.push({ name: k, action: window.REAL_ACTIONS[k] });
      }
    }
    return result;
  };

  /* ========================================================================
   * 补充：工具函数
   * ======================================================================== */

  /**
   * 根据比赛 ID 在日程表中查找比赛定义
   * @param {string} contestId 比赛 ID，如 'CSP-S1', 'NOIP' 等
   * @returns {Object|null} 比赛定义对象或 null
   */
  window.getContestById = function (contestId) {
    if (!window.REAL_CONTEST_SCHEDULE) return null;
    for (var i = 0; i < window.REAL_CONTEST_SCHEDULE.length; i++) {
      if (window.REAL_CONTEST_SCHEDULE[i].id === contestId) {
        return window.REAL_CONTEST_SCHEDULE[i];
      }
    }
    return null;
  };

  /**
   * 获取某个学生可以参加的所有比赛列表（考虑前置条件）
   * @param {Object} passedContests 学生已通过的比赛 ID 集合 (Set 或 Array)
   * @returns {Array} 可参加的比赛数组
   */
  window.getAvailableContests = function (passedContests) {
    var result = [];
    if (!window.REAL_CONTEST_SCHEDULE) return result;

    // 将传入的集合转为便于查找的形式
    var passed = {};
    if (passedContests instanceof Set) {
      passedContests.forEach(function (id) { passed[id] = true; });
    } else if (Array.isArray(passedContests)) {
      for (var i = 0; i < passedContests.length; i++) {
        passed[passedContests[i]] = true;
      }
    }

    for (var j = 0; j < window.REAL_CONTEST_SCHEDULE.length; j++) {
      var c = window.REAL_CONTEST_SCHEDULE[j];
      // 检查前置条件
      if (c.qualificationFrom && !passed[c.qualificationFrom]) {
        continue; // 未满足前置条件
      }
      result.push(c);
    }
    return result;
  };

  /**
   * 根据难度值筛选任务池，返回匹配的任务
   * @param {number} minDiff 最小难度
   * @param {number} maxDiff 最大难度
   * @param {string} [knowledgeType] 可选：按知识点筛选
   * @returns {Array} 匹配的任务数组
   */
  window.filterTasks = function (minDiff, maxDiff, knowledgeType) {
    var result = [];
    if (!window.REAL_TASK_POOL) return result;

    var min = Number(minDiff) || 0;
    var max = Number(maxDiff) || Infinity;

    for (var i = 0; i < window.REAL_TASK_POOL.length; i++) {
      var task = window.REAL_TASK_POOL[i];
      if (task.difficulty < min || task.difficulty > max) continue;

      // 如果指定了知识点类型，检查 boosts 中是否包含该类型
      if (knowledgeType) {
        var found = false;
        for (var j = 0; j < task.boosts.length; j++) {
          if (task.boosts[j].type === knowledgeType) {
            found = true;
            break;
          }
        }
        if (!found) continue;
      }

      result.push(task);
    }
    return result;
  };

  /**
   * 获取比赛链（按赛季时间排序的晋级链）
   * @returns {Array} 按周排序的比赛 ID 数组
   */
  window.getContestChain = function () {
    if (!window.REAL_CONTEST_SCHEDULE) return [];
    var chain = [];
    // 按周数排序
    var sorted = window.REAL_CONTEST_SCHEDULE.slice().sort(function (a, b) {
      return a.week - b.week;
    });
    for (var i = 0; i < sorted.length; i++) {
      chain.push(sorted[i].id);
    }
    return chain;
  };

  /* ========================================================================
   * 加载完成提示（开发阶段使用，上线后可移除）
   * ======================================================================== */
  if (typeof console !== 'undefined') {
    console.log('[Real Mode] real-data.js 加载完成 — 共 '
      + window.REAL_CONTEST_SCHEDULE.length + ' 场比赛, '
      + window.REAL_TASK_POOL.length + ' 个训练任务, '
      + Object.keys(window.REAL_ACTIONS).length + ' 种行动');
  }

})();
