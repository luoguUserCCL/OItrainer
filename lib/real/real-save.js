/**
 * real-save.js - OItrainer "Real Mode" 存档/读档管理模块
 *
 * 支持 5 个手动存档槽位 + 1 个自动存档槽位。
 * 使用 localStorage 进行持久化存储。
 *
 * ES5 语法，window.* 全局对象，不使用 ES6 模块。
 * 依赖：无硬依赖（反序列化时需要 window.Student, window.Facilities, window.GameState）
 */
(function () {
  'use strict';

  // ========== 零填充辅助 ==========
  function _pad(n) {
    return n < 10 ? '0' + n : '';
  }

  // ========== 版本号（用于未来格式迁移） ==========
  var SAVE_VERSION = 1;

  // ========== 主对象 ==========
  window.RealSaveManager = {

    /** 自动存档键 */
    AUTO_SAVE_KEY: 'oi_real_save_auto',

    /** 手动存档键前缀 */
    SLOT_KEY_PREFIX: 'oi_real_save_slot_',

    /** 手动存档最大槽位数 */
    MAX_SLOTS: 5,

    // ------------------------------------------------------------------
    //  存档操作
    // ------------------------------------------------------------------

    /**
     * 保存游戏状态到指定槽位
     * @param {number} slotIndex - 槽位索引：0-4 为手动存档，-1 为自动存档
     * @param {Object} serializedData - 已序列化的游戏状态对象（来自 RealGame._serializeState()）
     * @return {boolean} 是否保存成功
     */
    save: function (slotIndex, serializedData) {
      var key = (slotIndex === -1)
        ? this.AUTO_SAVE_KEY
        : this.SLOT_KEY_PREFIX + slotIndex;

      var slotName;
      if (slotIndex === -1) {
        slotName = '自动存档';
      } else {
        slotName = (serializedData && serializedData.saveSlotNames && serializedData.saveSlotNames[slotIndex])
          || ('存档 ' + (slotIndex + 1));
      }

      var saveData = {
        version: SAVE_VERSION,
        timestamp: Date.now(),
        week: (serializedData && serializedData.week) || 0,
        slotName: slotName,
        data: serializedData  // 直接存储，不再二次序列化
      };

      try {
        localStorage.setItem(key, JSON.stringify(saveData));
        return true;
      } catch (e) {
        console.error('[RealSaveManager] 保存失败 (slot ' + slotIndex + '):', e);
        return false;
      }
    },

    /**
     * 从指定槽位加载原始序列化数据
     * @param {number} slotIndex - 槽位索引：0-4 为手动存档，-1 为自动存档
     * @return {Object|null} 原始序列化数据（供 RealGame._deserializeState 使用），失败返回 null
     */
    load: function (slotIndex) {
      var key = (slotIndex === -1)
        ? this.AUTO_SAVE_KEY
        : this.SLOT_KEY_PREFIX + slotIndex;

      try {
        var raw = localStorage.getItem(key);
        if (!raw) {
          console.log('[RealSaveManager] 槽位 ' + slotIndex + ' 无存档数据');
          return null;
        }

        var saveData = JSON.parse(raw);
        if (!saveData || !saveData.data) {
          console.error('[RealSaveManager] 存档数据格式无效 (slot ' + slotIndex + ')');
          return null;
        }

        // 返回原始数据，附带元信息
        saveData.data._saveSlotName = saveData.slotName || '';
        saveData.data._saveTimestamp = saveData.timestamp || 0;
        return saveData.data;
      } catch (e) {
        console.error('[RealSaveManager] 加载失败 (slot ' + slotIndex + '):', e);
        return null;
      }
    },

    /**
     * 删除指定槽位的存档
     * @param {number} slotIndex - 槽位索引（-1 表示自动存档）
     */
    deleteSlot: function (slotIndex) {
      var key = (slotIndex === -1)
        ? this.AUTO_SAVE_KEY
        : this.SLOT_KEY_PREFIX + slotIndex;
      try {
        localStorage.removeItem(key);
      } catch (e) {
        console.error('[RealSaveManager] 删除槽位失败:', e);
      }
    },

    /**
     * 快捷自动存档
     * @param {Object} gameState - 游戏状态对象
     * @return {boolean}
     */
    autoSave: function (gameState) {
      return this.save(-1, gameState);
    },

    // ------------------------------------------------------------------
    //  存档列表查询
    // ------------------------------------------------------------------

    /**
     * 列出所有非空槽位的信息
     * @return {Array<{index: number, name: string, week: number, timestamp: number, dateStr: string, isAuto: boolean}>}
     */
    listSlots: function () {
      var result = [];

      // 先扫描自动存档（index=-1）
      var autoRaw = null;
      try { autoRaw = localStorage.getItem(this.AUTO_SAVE_KEY); } catch (e) { /* 忽略 */ }
      if (autoRaw) {
        try {
          var autoData = JSON.parse(autoRaw);
          if (autoData) {
            result.push({
              index: -1,
              name: autoData.slotName || '自动存档',
              week: autoData.week || 0,
              timestamp: autoData.timestamp || 0,
              dateStr: this.formatTimestamp(autoData.timestamp || 0),
              isAuto: true
            });
          }
        } catch (e) { /* 忽略解析失败 */ }
      }

      // 扫描手动存档槽位
      for (var i = 0; i < this.MAX_SLOTS; i++) {
        var key = this.SLOT_KEY_PREFIX + i;
        var raw = null;
        try { raw = localStorage.getItem(key); } catch (e) { /* 忽略 */ }
        if (raw) {
          try {
            var data = JSON.parse(raw);
            if (data) {
              result.push({
                index: i,
                name: data.slotName || ('存档 ' + (i + 1)),
                week: data.week || 0,
                timestamp: data.timestamp || 0,
                dateStr: this.formatTimestamp(data.timestamp || 0),
                isAuto: false
              });
            }
          } catch (e) { /* 忽略解析失败 */ }
        }
      }

      return result;
    },

    /**
     * 检查是否存在任何存档（含自动存档）
     * @return {boolean}
     */
    hasAnySave: function () {
      for (var i = -1; i < this.MAX_SLOTS; i++) {
        var key = (i === -1) ? this.AUTO_SAVE_KEY : this.SLOT_KEY_PREFIX + i;
        try {
          if (localStorage.getItem(key)) return true;
        } catch (e) { /* 忽略 */ }
      }
      return false;
    },

    // ------------------------------------------------------------------
    //  时间格式化
    // ------------------------------------------------------------------

    /**
     * 将时间戳格式化为 "YYYY-MM-DD HH:mm"
     * @param {number} ts - Unix 时间戳（毫秒）
     * @return {string}
     */
    formatTimestamp: function (ts) {
      if (!ts || typeof ts !== 'number' || ts <= 0) {
        return '未知时间';
      }
      var d = new Date(ts);
      return (
        d.getFullYear() + '-' + _pad(d.getMonth() + 1) + '-' + _pad(d.getDate()) +
        ' ' + _pad(d.getHours()) + ':' + _pad(d.getMinutes())
      );
    },

    // ------------------------------------------------------------------
    //  序列化 / 反序列化 - 内部方法
    // ------------------------------------------------------------------

    /**
     * 将游戏状态序列化为可 JSON 存储的纯对象
     *
     * 处理要点：
     *   - Student.talents (Set) → Array
     *   - GameState.qualification (Set) → Array
     *   - GameState.completedCompetitions (Set) → Array
     *   - Facilities 保持为纯对象（反序列化时重建）
     *   - BudgetManager 序列化其内部状态
     *   - 忽略函数类型属性
     *
     * @param {Object} gameState - 完整的游戏状态
     * @return {Object} 序列化后的纯数据对象
     */
    _serializeGameState: function (gameState) {
      if (!gameState || typeof gameState !== 'object') {
        return {};
      }

      var data = {};

      // --- 基础标量字段 ---
      var scalarKeys = [
        'week', 'reputation', 'budget', 'temperature', 'weather',
        'province_name', 'province_type', 'is_north', 'province_id',
        'province_climate', 'difficulty', 'base_comfort',
        'initial_students', 'quit_students',
        'had_good_result_recently', 'weeks_since_entertainment',
        'weeks_since_good_result', 'seasonEndTriggered',
        'totalExpenses', 'lastTrainingFinishedWeek',
        'inNationalTeam', 'nationalTeamChoicePending'
      ];
      for (var i = 0; i < scalarKeys.length; i++) {
        var k = scalarKeys[i];
        if (typeof gameState[k] !== 'undefined' && typeof gameState[k] !== 'function') {
          data[k] = gameState[k];
        }
      }

      // --- 存档槽位名称 ---
      if (gameState.saveSlotNames) {
        data.saveSlotNames = gameState.saveSlotNames.slice();
      }

      // --- 学生数组（Set → Array） ---
      data.students = [];
      if (Array.isArray(gameState.students)) {
        for (var s = 0; s < gameState.students.length; s++) {
          var student = gameState.students[s];
          if (!student || typeof student !== 'object') continue;
          data.students.push(this._serializeStudent(student));
        }
      }

      // --- 设施 ---
      if (gameState.facilities) {
        data.facilities = {
          computer: gameState.facilities.computer || 1,
          ac: gameState.facilities.ac || 1,
          dorm: gameState.facilities.dorm || 1,
          library: gameState.facilities.library || 1,
          canteen: gameState.facilities.canteen || 1
        };
      }

      // --- 预算管理器 ---
      if (typeof window !== 'undefined' && window.BudgetManager &&
          typeof window.BudgetManager.serialize === 'function') {
        data.budgetManager = window.BudgetManager.serialize();
      }

      // --- 晋级资格 qualification: [{}, {}]，每项包含各比赛名称 → Set ---
      // qualification[0] = 第一赛季, qualification[1] = 第二赛季
      data.qualification = [[], []];
      if (Array.isArray(gameState.qualification)) {
        for (var half = 0; half < 2 && half < gameState.qualification.length; half++) {
          var halfQual = gameState.qualification[half];
          if (!halfQual || typeof halfQual !== 'object') continue;
          var halfObj = {};
          for (var contestName in halfQual) {
            if (!halfQual.hasOwnProperty(contestName)) continue;
            var qualSet = halfQual[contestName];
            if (typeof qualSet === 'object' && typeof qualSet.values === 'function') {
              // Set → Array
              halfObj[contestName] = Array.from(qualSet);
            } else if (Array.isArray(qualSet)) {
              halfObj[contestName] = qualSet.slice();
            } else {
              halfObj[contestName] = [];
            }
          }
          data.qualification[half] = halfObj;
        }
      }

      // --- 已完成的比赛（Set → Array） ---
      if (gameState.completedCompetitions) {
        if (typeof gameState.completedCompetitions.values === 'function') {
          data.completedCompetitions = Array.from(gameState.completedCompetitions);
        } else if (Array.isArray(gameState.completedCompetitions)) {
          data.completedCompetitions = gameState.completedCompetitions.slice();
        } else {
          data.completedCompetitions = [];
        }
      }

      // --- NOI 排名 ---
      if (Array.isArray(gameState.noi_rankings)) {
        data.noi_rankings = gameState.noi_rankings.slice();
      }

      // --- 职业比赛记录 ---
      if (Array.isArray(gameState.careerCompetitions)) {
        data.careerCompetitions = gameState.careerCompetitions.slice();
      }

      // --- 本周训练题目（可选恢复） ---
      if (Array.isArray(gameState.weeklyTasks)) {
        data.weeklyTasks = gameState.weeklyTasks.slice();
      }

      // --- 遍历剩余未处理的属性（容错：序列化任何非函数值） ---
      for (var prop in gameState) {
        if (!gameState.hasOwnProperty(prop)) continue;
        // 跳过已处理和已知特殊类型
        if (data.hasOwnProperty(prop)) continue;
        if (typeof gameState[prop] === 'function') continue;
        // 跳过原型上的方法
        try {
          var val = gameState[prop];
          // 不序列化 DOM 元素、函数等不可 JSON 化的值
          if (val === null || typeof val === 'number' || typeof val === 'string' || typeof val === 'boolean') {
            data[prop] = val;
          }
        } catch (e) { /* 忽略不可访问属性 */ }
      }

      return data;
    },

    /**
     * 序列化单个学生对象
     * @param {Object} student - Student 实例
     * @return {Object} 纯数据对象
     */
    _serializeStudent: function (student) {
      var s = {};

      // 基础标识
      s.name = student.name || '';

      // 基础能力值（永久值）
      s._base_thinking = student._base_thinking || student.thinking || 0;
      s._base_coding = student._base_coding || student.coding || 0;
      s._base_mental = student._base_mental || student.mental || 0;

      // 临时增益（比赛/模拟赛修改）
      if (student._temp_modifiers) {
        s._temp_modifiers = {};
        for (var key in student._temp_modifiers) {
          if (student._temp_modifiers.hasOwnProperty(key)) {
            s._temp_modifiers[key] = student._temp_modifiers[key] || 0;
          }
        }
      }

      // 知识点
      s.knowledge_ds = student.knowledge_ds || 15;
      s.knowledge_graph = student.knowledge_graph || 15;
      s.knowledge_string = student.knowledge_string || 15;
      s.knowledge_math = student.knowledge_math || 15;
      s.knowledge_dp = student.knowledge_dp || 15;

      // 心理状态
      s.pressure = student.pressure || 0;
      s.comfort = student.comfort || 50;
      s.comfort_modifier = student.comfort_modifier || 0;
      s.pressure_modifier = student.pressure_modifier || 0;
      s.burnout_weeks = student.burnout_weeks || 0;
      s.depression_count = student.depression_count || 0;
      s.high_pressure_weeks = student.high_pressure_weeks || 0;

      // 状态
      s.active = (student.active !== false);

      // 生病
      s.sick_weeks = student.sick_weeks || 0;

      // 天赋/特质（Set → Array）
      if (student.talents) {
        if (typeof student.talents.values === 'function') {
          s.talents = Array.from(student.talents);
        } else if (Array.isArray(student.talents)) {
          s.talents = student.talents.slice();
        } else {
          s.talents = [];
        }
      } else {
        s.talents = [];
      }

      // --- 扩展属性（Real Mode 新增字段，可能不存在于旧版本） ---
      var extendedKeys = [
        'personality', 'hiddenPersonalities', 'gender',
        'stamina', 'physique', 'academicScore',
        'quit_tendency_weeks', 'hiddenMockScore'
      ];
      for (var i = 0; i < extendedKeys.length; i++) {
        var ek = extendedKeys[i];
        if (typeof student[ek] !== 'undefined' && typeof student[ek] !== 'function') {
          s[ek] = student[ek];
        }
      }

      return s;
    },

    /**
     * 将序列化数据反序列化为完整的游戏状态对象
     *
     * 处理要点：
     *   - 重建 Student 实例（Array → Set for talents）
     *   - 重建 Facilities 实例
     *   - 恢复 GameState 各字段
     *   - 恢复 BudgetManager 状态
     *   - 恢复晋级资格（Array → Set）
     *
     * @param {Object} data - _serializeGameState() 返回的数据
     * @return {Object|null} 恢复后的游戏状态对象
     */
    _deserializeGameState: function (data) {
      if (!data || typeof data !== 'object') {
        console.error('[RealSaveManager] 反序列化失败：数据为空');
        return null;
      }

      var gameState = null;

      // 尝试使用全局 GameState 构造函数创建实例
      try {
        if (typeof window !== 'undefined' && window.GameState) {
          gameState = new window.GameState();
        } else {
          // 回退：创建空对象
          gameState = {};
          console.warn('[RealSaveManager] GameState 构造函数不可用，使用空对象');
        }
      } catch (e) {
        gameState = {};
        console.error('[RealSaveManager] 创建 GameState 实例失败:', e);
      }

      // --- 恢复基础标量字段 ---
      var scalarKeys = [
        'week', 'reputation', 'budget', 'temperature', 'weather',
        'province_name', 'province_type', 'is_north', 'province_id',
        'province_climate', 'difficulty', 'base_comfort',
        'initial_students', 'quit_students',
        'had_good_result_recently', 'weeks_since_entertainment',
        'weeks_since_good_result', 'seasonEndTriggered',
        'totalExpenses', 'lastTrainingFinishedWeek',
        'inNationalTeam', 'nationalTeamChoicePending'
      ];
      for (var i = 0; i < scalarKeys.length; i++) {
        var k = scalarKeys[i];
        if (typeof data[k] !== 'undefined') {
          gameState[k] = data[k];
        }
      }

      // --- 恢复存档槽位名称 ---
      if (Array.isArray(data.saveSlotNames)) {
        gameState.saveSlotNames = data.saveSlotNames.slice();
      }

      // --- 恢复设施 ---
      if (data.facilities && typeof data.facilities === 'object') {
        try {
          if (typeof window !== 'undefined' && window.Facilities) {
            gameState.facilities = Object.assign(new window.Facilities(), data.facilities);
          } else {
            gameState.facilities = data.facilities;
          }
        } catch (e) {
          gameState.facilities = data.facilities;
          console.error('[RealSaveManager] 恢复 Facilities 失败:', e);
        }
      }

      // --- 恢复学生数组（Array → Set for talents） ---
      gameState.students = [];
      if (Array.isArray(data.students)) {
        for (var s = 0; s < data.students.length; s++) {
          var studentData = data.students[s];
          if (!studentData || typeof studentData !== 'object') continue;

          var student = null;
          try {
            if (typeof window !== 'undefined' && window.Student) {
              student = new window.Student(
                studentData._base_thinking || studentData.thinking || 30,
                studentData._base_coding || studentData.coding || 30,
                studentData._base_mental || studentData.mental || 50
              );
            } else {
              student = {};
              console.warn('[RealSaveManager] Student 构造函数不可用，使用空对象');
            }
          } catch (e) {
            student = {};
            console.error('[RealSaveManager] 创建 Student 实例失败:', e);
          }

          // 覆盖所有序列化字段
          student.name = studentData.name || '';
          student._base_thinking = studentData._base_thinking || studentData.thinking || 0;
          student._base_coding = studentData._base_coding || studentData.coding || 0;
          student._base_mental = studentData._base_mental || studentData.mental || 0;

          // 知识点
          student.knowledge_ds = studentData.knowledge_ds || 15;
          student.knowledge_graph = studentData.knowledge_graph || 15;
          student.knowledge_string = studentData.knowledge_string || 15;
          student.knowledge_math = studentData.knowledge_math || 15;
          student.knowledge_dp = studentData.knowledge_dp || 15;

          // 心理状态
          student.pressure = studentData.pressure || 0;
          student.comfort = studentData.comfort || 50;
          student.comfort_modifier = studentData.comfort_modifier || 0;
          student.pressure_modifier = studentData.pressure_modifier || 0;
          student.burnout_weeks = studentData.burnout_weeks || 0;
          student.depression_count = studentData.depression_count || 0;
          student.high_pressure_weeks = studentData.high_pressure_weeks || 0;

          // 状态
          student.active = (studentData.active !== false);
          student.sick_weeks = studentData.sick_weeks || 0;

          // 天赋：Array → Set
          if (Array.isArray(studentData.talents)) {
            if (typeof student.talents === 'object' && typeof student.talents.add === 'function') {
              // 已经是 Set（构造函数创建的）
              student.talents.clear();
              for (var t = 0; t < studentData.talents.length; t++) {
                student.talents.add(studentData.talents[t]);
              }
            } else {
              // 空对象，手动创建 Set
              student.talents = new Set(studentData.talents);
            }
          } else if (studentData.talents && typeof studentData.talents === 'object') {
            // 兼容旧格式：Object → Set
            if (typeof student.talents.clear === 'function') {
              student.talents.clear();
            } else {
              student.talents = new Set();
            }
            for (var tKey in studentData.talents) {
              if (studentData.talents.hasOwnProperty(tKey) && studentData.talents[tKey]) {
                student.talents.add(tKey);
              }
            }
          }

          // 临时增益
          if (studentData._temp_modifiers && typeof studentData._temp_modifiers === 'object') {
            if (!student._temp_modifiers) {
              student._temp_modifiers = {};
            }
            for (var mk in studentData._temp_modifiers) {
              if (studentData._temp_modifiers.hasOwnProperty(mk)) {
                student._temp_modifiers[mk] = studentData._temp_modifiers[mk] || 0;
              }
            }
          }

          // 扩展属性
          var extendedKeys = [
            'personality', 'hiddenPersonalities', 'gender',
            'stamina', 'physique', 'academicScore',
            'quit_tendency_weeks', 'hiddenMockScore'
          ];
          for (var ei = 0; ei < extendedKeys.length; ei++) {
            var ek = extendedKeys[ei];
            if (typeof studentData[ek] !== 'undefined') {
              student[ek] = studentData[ek];
            }
          }

          gameState.students.push(student);
        }
      }

      // --- 恢复晋级资格（Array → Set） ---
      gameState.qualification = [{}, {}];
      if (Array.isArray(data.qualification)) {
        for (var half = 0; half < 2 && half < data.qualification.length; half++) {
          var halfQual = data.qualification[half];
          if (!halfQual || typeof halfQual !== 'object') continue;

          var halfObj = {};
          for (var contestName in halfQual) {
            if (!halfQual.hasOwnProperty(contestName)) continue;
            var qualArr = halfQual[contestName];
            if (Array.isArray(qualArr)) {
              halfObj[contestName] = new Set(qualArr);
            } else if (typeof qualArr === 'object' && typeof qualArr.values === 'function') {
              halfObj[contestName] = qualArr;
            } else {
              halfObj[contestName] = new Set();
            }
          }
          gameState.qualification[half] = halfObj;
        }
      }

      // --- 恢复已完成比赛（Array → Set） ---
      if (Array.isArray(data.completedCompetitions)) {
        gameState.completedCompetitions = new Set(data.completedCompetitions);
      } else {
        gameState.completedCompetitions = new Set();
      }

      // --- 恢复 NOI 排名 ---
      if (Array.isArray(data.noi_rankings)) {
        gameState.noi_rankings = data.noi_rankings.slice();
      }

      // --- 恢复职业比赛记录 ---
      if (Array.isArray(data.careerCompetitions)) {
        gameState.careerCompetitions = data.careerCompetitions.slice();
      }

      // --- 恢复本周训练题目 ---
      if (Array.isArray(data.weeklyTasks)) {
        gameState.weeklyTasks = data.weeklyTasks.slice();
      }

      // --- 恢复 BudgetManager 状态 ---
      if (data.budgetManager && typeof data.budgetManager === 'object') {
        try {
          if (typeof window !== 'undefined' && window.BudgetManager &&
              typeof window.BudgetManager.deserialize === 'function') {
            window.BudgetManager.deserialize(data.budgetManager);
          }
        } catch (e) {
          console.error('[RealSaveManager] 恢复 BudgetManager 失败:', e);
        }
      }

      // --- 将结果挂载到全局 ---
      try {
        if (typeof window !== 'undefined') {
          window.game = gameState;
        }
      } catch (e) { /* 忽略 */ }

      return gameState;
    }
  };

})();
