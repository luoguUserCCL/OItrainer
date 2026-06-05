/**
 * real-budget.js - OItrainer "Real Mode" 预算/财务管理模块
 *
 * 负责：初始资金、每周维护费、政府拨款、声誉奖励、
 *       比赛报名费检查、经费消费/收入日志、存档序列化。
 *
 * ES5 语法，window.* 全局对象，不使用 ES6 模块。
 * 依赖：无（可选依赖 window.RealCalendar 用于学期判断）
 */
(function () {
  'use strict';

  // ========== 学期周判断（若 RealCalendar 不可用，使用本地简单判断） ==========
  // 真实模式 96 周赛季：
  //   第一学期：第1-16周（开学第1周），第49-64周（开学第49周）
  //   第二学期：第21-40周（开学第21周），第69-88周（开学第69周）
  // 政府拨款在每学期开学时发放：第1、21、49、69周
  function _isTermStart(week) {
    return week === 1 || week === 21 || week === 49 || week === 69;
  }

  // ========== 月薪判断 ==========
  // 每月第4周（week % 4 === 0）为月薪发放日
  function _isMonthEnd(week) {
    return (week % 4 === 0);
  }

  // ========== 主对象 ==========
  window.BudgetManager = {

    /** localStorage 键前缀（用于持久化预算日志等可选数据） */
    STORAGE_PREFIX: 'oi_real_budget_',

    /** 当前资金（整数，单位：元） */
    funds: 0,

    /** 支出日志 [{week: Number, amount: Number, description: String}] */
    expenseLog: [],

    /** 收入日志 [{week: Number, amount: Number, description: String}] */
    incomeLog: [],

    // ------------------------------------------------------------------
    //  初始化
    // ------------------------------------------------------------------

    /**
     * 初始化预算管理器
     * @param {number} [initialFunds=80000] - 初始资金。Real模式默认80000（普通省×普通难度）。
     */
    init: function (initialFunds) {
      this.funds = (typeof initialFunds === 'number') ? initialFunds : 80000;
      this.expenseLog = [];
      this.incomeLog = [];
    },

    // ------------------------------------------------------------------
    //  查询
    // ------------------------------------------------------------------

    /**
     * 返回当前资金
     * @return {number}
     */
    getFunds: function () {
      return this.funds;
    },

    /**
     * 返回支出日志总额
     * @return {number}
     */
    getTotalExpenses: function () {
      var total = 0;
      for (var i = 0; i < this.expenseLog.length; i++) {
        total += (this.expenseLog[i].amount || 0);
      }
      return total;
    },

    /**
     * 返回收入日志总额
     * @return {number}
     */
    getTotalIncome: function () {
      var total = 0;
      for (var i = 0; i < this.incomeLog.length; i++) {
        total += (this.incomeLog[i].amount || 0);
      }
      return total;
    },

    /**
     * 格式化资金为人民币字符串 "¥50,000"
     * @return {string}
     */
    formatFunds: function () {
      return '\u00a5' + this.funds.toLocaleString();
    },

    // ------------------------------------------------------------------
    //  消费 / 收入
    // ------------------------------------------------------------------

    /**
     * 消费经费
     * @param {number} amount - 消费金额（正整数）
     * @param {string} description - 消费描述
     * @param {number} [week] - 周数（默认使用 game.week）
     * @return {boolean} true=成功；当余额不足时仍允许消费并返回 true（仅记录警告）
     */
    spend: function (amount, description, week) {
      amount = Math.max(0, Math.floor(amount || 0));
      var currentWeek = week;
      if (typeof currentWeek !== 'number' || currentWeek <= 0) {
        // 尝试从全局 game 获取当前周
        try {
          currentWeek = (typeof window !== 'undefined' && window.game && window.game.week) ? window.game.week : 0;
        } catch (e) {
          currentWeek = 0;
        }
      }

      // 余额不足时记录警告（但不阻止消费——允许超支）
      if (this.funds < amount && amount > 0) {
        try {
          console.warn(
            '[BudgetManager] 余额不足警告：当前 ¥' + this.funds +
            '，消费 ¥' + amount + '（' + (description || '') + '），第' + currentWeek + '周'
          );
        } catch (e) { /* 忽略 */ }
      }

      this.funds -= amount;
      this.expenseLog.push({
        week: currentWeek,
        amount: amount,
        description: description || ''
      });
      return true;
    },

    /**
     * 接收收入（拨款、奖励等）
     * @param {number} amount - 收入金额（正整数）
     * @param {string} description - 收入描述
     * @param {number} [week] - 周数（默认使用 game.week）
     */
    receive: function (amount, description, week) {
      amount = Math.max(0, Math.floor(amount || 0));
      var currentWeek = week;
      if (typeof currentWeek !== 'number' || currentWeek <= 0) {
        try {
          currentWeek = (typeof window !== 'undefined' && window.game && window.game.week) ? window.game.week : 0;
        } catch (e) {
          currentWeek = 0;
        }
      }

      this.funds += amount;
      this.incomeLog.push({
        week: currentWeek,
        amount: amount,
        description: description || ''
      });
    },

    // ------------------------------------------------------------------
    //  每周处理
    // ------------------------------------------------------------------

    /**
     * 每周结算时调用：处理政府拨款与声誉奖励
     *
     * 政府拨款规则：
     *   - 每学期开学时（第1周、第17周）发放 ¥10,000
     * 声誉奖励规则：
     *   - 声誉 > 60 时，每周获得 (reputation - 60) * 2 的额外收入
     *
     * @param {number} week - 当前周数
     * @param {number} reputation - 当前声誉值（0-100）
     */
    processWeeklyIncome: function (week, reputation) {
      week = week || 0;
      reputation = (typeof reputation === 'number') ? reputation : 0;

      // 学期判断：优先使用 RealCalendar，回退到本地判断
      var isStart = false;
      if (typeof window !== 'undefined' && window.RealCalendar && typeof window.RealCalendar.isTermStart === 'function') {
        isStart = RealCalendar.isTermStart(week);
      } else {
        isStart = _isTermStart(week);
      }

      // 学期开学：政府拨款 ¥10,000
      if (isStart) {
        this.receive(10000, '政府拨款', week);
      }

      // 月薪：每月第4周固定获得 ¥10,000
      if (_isMonthEnd(week)) {
        this.receive(10000, '月薪', week);
      }

      // 声誉 > 60 时给予每周声誉奖励
      if (reputation > 60) {
        var bonus = Math.floor((reputation - 60) * 2);
        this.receive(bonus, '声誉奖励', week);
      }

      // 注意：奖牌/比赛奖金由外部在获奖时手动调用 receive() 记录
    },

    /**
     * 计算每周维护费用
     * 公式：基础 ¥1,000 + ¥200 * 活跃学生人数
     * @param {number} activeStudentCount - 当前活跃学生数（默认1）
     * @return {number} 每周维护费用
     */
    getWeeklyMaintenance: function (activeStudentCount) {
      var count = (typeof activeStudentCount === 'number' && activeStudentCount > 0)
        ? activeStudentCount : 1;
      return 1000 + 200 * count;
    },

    // ------------------------------------------------------------------
    //  比赛报名费
    // ------------------------------------------------------------------

    /**
     * 检查是否能够负担比赛报名费
     * @param {Object} contestDef - 比赛定义对象，包含 registrationFee 字段
     * @return {boolean}
     */
    canAffordContest: function (contestDef) {
      if (!contestDef || typeof contestDef !== 'object') return false;
      var fee = contestDef.registrationFee || 0;
      return this.funds >= fee;
    },

    // ------------------------------------------------------------------
    //  序列化 / 反序列化
    // ------------------------------------------------------------------

    /**
     * 序列化为可 JSON 存储的纯对象
     * @return {Object} { funds, expenseLog, incomeLog }
     */
    serialize: function () {
      return {
        funds: this.funds,
        expenseLog: this.expenseLog.slice(),  // 浅拷贝数组
        incomeLog: this.incomeLog.slice()
      };
    },

    /**
     * 从序列化数据恢复状态
     * @param {Object} data - serialize() 返回的数据
     */
    deserialize: function (data) {
      if (!data || typeof data !== 'object') return;

      this.funds = (typeof data.funds === 'number') ? data.funds : 80000;

      // 恢复支出日志（确保每条记录包含必要字段）
      if (Array.isArray(data.expenseLog)) {
        this.expenseLog = [];
        for (var i = 0; i < data.expenseLog.length; i++) {
          var entry = data.expenseLog[i];
          if (entry && typeof entry === 'object') {
            this.expenseLog.push({
              week: entry.week || 0,
              amount: entry.amount || 0,
              description: entry.description || ''
            });
          }
        }
      } else {
        this.expenseLog = [];
      }

      // 恢复收入日志
      if (Array.isArray(data.incomeLog)) {
        this.incomeLog = [];
        for (var j = 0; j < data.incomeLog.length; j++) {
          var entry2 = data.incomeLog[j];
          if (entry2 && typeof entry2 === 'object') {
            this.incomeLog.push({
              week: entry2.week || 0,
              amount: entry2.amount || 0,
              description: entry2.description || ''
            });
          }
        }
      } else {
        this.incomeLog = [];
      }
    },

    // ------------------------------------------------------------------
    //  调试工具
    // ------------------------------------------------------------------

    /**
     * 输出当前预算摘要到控制台（调试用）
     */
    debugSummary: function () {
      console.log(
        '[BudgetManager] 资金: ' + this.formatFunds() +
        ' | 总支出: ¥' + this.getTotalExpenses().toLocaleString() +
        ' | 总收入: ¥' + this.getTotalIncome().toLocaleString() +
        ' | 日志数: 支出' + this.expenseLog.length + '条 / 收入' + this.incomeLog.length + '条'
      );
    }
  };

})();
