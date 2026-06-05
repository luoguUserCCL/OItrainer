/* ==========================================================================
 * real-events.js — OItrainer「Real Mode」事件系统
 * --------------------------------------------------------------------------
 * 本文件实现 Real Mode 的周事件引擎，负责在每周结算时检测并触发各类
 * 随机 / 周期事件（假期、天气、生病、压力警告、比赛提醒等）。
 *
 * 设计原则：
 *   1. 事件采用声明式注册：每个事件由 { id, name, type, check, run } 组成
 *   2. check(ctx) → bool：判断当前周是否应触发该事件
 *   3. run(ctx) → { messages, effects } | null：执行事件逻辑并返回结果
 *   4. 同一事件在同一周不会重复触发
 *   5. 天赋获取作为独立钩子提供，不纳入周事件循环
 *
 * 风格约定（与 real-data.js / real-budget.js / real-personality.js 保持一致）：
 *   - 使用 var，不使用 let / const
 *   - 不使用箭头函数、模板字符串、解构等 ES6+ 特性
 *   - 所有全局挂载统一使用 window.* 前缀
 *   - 注释使用中文
 * ========================================================================== */

(function (global) {
  'use strict';

  /* ========================================================================
   * 内部工具
   * ======================================================================== */

  // 临时存储：生病事件在 check 阶段确定受影响学生索引，run 阶段使用
  // （避免 check 和 run 分别独立掷骰导致结果不一致）
  var _sickStudentIndices = [];

  // 临时存储：体质优良事件在 check 阶段确定受影响学生索引
  var _goodPhysiqueIndices = [];

  // 临时存储：台风事件标记
  var _typhoonActive = false;

  /* ========================================================================
   * RealEventManager — Real Mode 事件管理器
   * ======================================================================== */

  var RealEventManager = {

    /** 已注册的事件列表 */
    _events: [],

    /**
     * 已触发事件记录
     * 键为周数（字符串），值为该周已触发的事件 id 数组
     * 用于防止同一事件在同一周重复触发
     */
    _triggeredEvents: {},

    /* ------------------------------------------------------------------
     * 初始化
     * ------------------------------------------------------------------ */

    /**
     * 初始化事件管理器
     * 清空所有已注册事件和触发记录，并重新注册所有内置事件
     */
    init: function () {
      this._events = [];
      this._triggeredEvents = {};
      this._registerDefaultEvents();
    },

    /* ------------------------------------------------------------------
     * 事件注册
     * ------------------------------------------------------------------ */

    /**
     * 注册一个事件
     * @param {Object} evt - 事件定义对象
     *   evt.id       {string}   - 事件唯一标识（如 'winter_vacation'）
     *   evt.name     {string}   - 事件中文名称（如 '寒假开始'）
     *   evt.type     {string}   - 事件类型：'info' | 'positive' | 'negative' | 'warning' | 'choice'
     *   evt.check    {function} - 检测函数，接收 context 参数，返回 boolean
     *   evt.run      {function} - 执行函数，接收 context 参数，返回 {messages, effects} 或 null
     */
    register: function (evt) {
      if (!evt || !evt.id) return;
      this._events.push(evt);
    },

    /* ------------------------------------------------------------------
     * 事件检测
     * ------------------------------------------------------------------ */

    /**
     * 检测当前周所有事件，返回已触发的事件结果列表
     *
     * @param {number} week - 当前周数（1-96）
     * @returns {Array} 已触发事件数组，每项格式：
     *   { id, name, type, messages, effects }
     */
    checkEvents: function (week) {
      var ctx = this._buildContext(week);
      var triggered = [];
      var i, evt, result;

      for (i = 0; i < this._events.length; i++) {
        evt = this._events[i];

        // 跳过同一周内已触发的事件，避免重复
        if (this._triggeredEvents[week] &&
            this._triggeredEvents[week].indexOf(evt.id) >= 0) {
          continue;
        }

        // 执行检测
        if (evt.check(ctx)) {
          result = evt.run(ctx);
          if (result) {
            triggered.push({
              id: evt.id,
              name: evt.name,
              type: evt.type,
              messages: result.messages || [],
              effects: result.effects || []
            });

            // 记录已触发
            if (!this._triggeredEvents[week]) {
              this._triggeredEvents[week] = [];
            }
            this._triggeredEvents[week].push(evt.id);
          }
        }
      }

      return triggered;
    },

    /* ------------------------------------------------------------------
     * 上下文构建
     * ------------------------------------------------------------------ */

    /**
     * 为指定周数构建事件检测上下文
     * @param {number} week - 周数
     * @returns {Object} 上下文对象，包含 week, game, students, term, isVacation, month
     */
    _buildContext: function (week) {
      var game = null;
      // 真实模式优先使用 RealGame.state
      if (typeof window !== 'undefined' && window.RealGame && window.RealGame.state) {
        game = window.RealGame.state;
      }
      // 简化模式回退
      if (!game && typeof window !== 'undefined' && window.game) {
        game = window.game;
      }
      return {
        week: week,
        game: game,
        students: (game && game.students) ? game.students : [],
        term: (typeof window !== 'undefined' && window.RealCalendar)
               ? RealCalendar.getTerm(week)
               : null,
        isVacation: (typeof window !== 'undefined' && window.RealCalendar)
                    ? RealCalendar.isVacation(week)
                    : false,
        month: (typeof window !== 'undefined' && window.RealCalendar)
                ? RealCalendar.getMonth(week)
                : null
      };
    },

    /* ------------------------------------------------------------------
     * 天赋获取钩子（独立于周事件循环）
     * ------------------------------------------------------------------ */

    /**
     * 训练后检查天赋获取
     *
     * 与原始 game.js 中 trainStudentsWithTask 调用 TalentManager.tryAcquireTalent 对应。
     * 在每次训练动作执行完毕后调用，检查是否有学生通过训练获得了新天赋。
     *
     * @param {Array} students - 参与训练的学生数组
     * @param {number} intensity - 训练强度（1=普通做题, 2=高强度, 3=集训）
     * @returns {Array} 天赋获取事件数组，每项格式：
     *   { type:'talent', student:学生名, talent:天赋名称 }
     */
    checkTalentAcquisition: function (students, intensity) {
      var events = [];
      var multiplier;

      // 训练强度越高，获得天赋的概率越大
      if (intensity === 1) {
        multiplier = 0.2;
      } else if (intensity === 2) {
        multiplier = 0.4;
      } else {
        multiplier = 0.8;
      }

      for (var i = 0; i < students.length; i++) {
        // 如果全局 TalentManager 存在且有 tryAcquireTalent 方法，则调用
        if (typeof window !== 'undefined' && window.TalentManager &&
            typeof TalentManager.tryAcquireTalent === 'function') {
          var result = TalentManager.tryAcquireTalent(students[i], multiplier);
          if (result) {
            events.push({
              type: 'talent',
              student: students[i].name,
              talent: result
            });
          }
        }
      }

      return events;
    },

    /* ------------------------------------------------------------------
     * 内置事件注册
     * ------------------------------------------------------------------ */

    /**
     * 注册所有内置事件
     * 顺序决定检测优先级，通常：
     *   学期/假期 → 信息提醒 → 随机事件（天气、生病、压力） → 奖励
     */
    _registerDefaultEvents: function () {
      var self = this;

      // ==================================================================
      // 1. 学期开始事件
      // ==================================================================

      /**
       * 第一周 — 新学期开始
       * 仅在 week === 1 时触发，显示欢迎信息
       */
      self.register({
        id: 'term_start_1',
        name: '新学期开始',
        type: 'info',
        check: function (ctx) {
          return ctx.week === 1;
        },
        run: function (ctx) {
          return {
            messages: ['新学期开始了！新的征程等待着你和学生们。'],
            effects: []
          };
        }
      });

      /**
       * 第二学期开始（第 25 周）
       * 下半年的比赛（NOIP、省选等）更加关键
       */
      self.register({
        id: 'term_start_2',
        name: '第二学期开始',
        type: 'info',
        check: function (ctx) {
          return ctx.week === 21 || ctx.week === 69;
        },
        run: function (ctx) {
          var yearLabel = (ctx.week <= 48) ? '高一' : '高二';
          return {
            messages: [yearLabel + '第二学期开始了！下半年的比赛更加关键，请做好充足准备。'],
            effects: []
          };
        }
      });

      // ==================================================================
      // 2. 寒假/暑假假期事件
      // ==================================================================

      /**
       * 寒假开始（第 21-24 周）
       * 所有学生获得：
       *   - 压力 -15（最低为 0）
       *   - 学业成绩 +3（最高 100）
       *   - 体力恢复 +15（不超上限）
       */
      self.register({
        id: 'winter_vacation',
        name: '寒假开始',
        type: 'info',
        check: function (ctx) {
          // ctx.term 是 RealCalendar.getTerm() 返回的对象，如 { term: '寒假', range: [21,24] }
          return ctx.term && ctx.term.term === '寒假';
        },
        run: function (ctx) {
          var messages = ['寒假开始了！学生们暂时放松下来，适当休息调整。'];
          var effects = [];

          for (var i = 0; i < ctx.students.length; i++) {
            var s = ctx.students[i];

            // 压力减少 15
            s.pressure = Math.max(0, (s.pressure || 0) - 15);
            // 学业成绩 +3
            s.academicScore = Math.min(100, (s.academicScore || 50) + 3);
            // 体力恢复 15
            s.stamina = Math.min(s.maxStamina || 100, (s.stamina || 0) + 15);

            effects.push({
              student: s.name,
              pressure: -15,
              academic: 3,
              staminaRecovery: 15
            });
          }

          return { messages: messages, effects: effects };
        }
      });

      /**
       * 暑假开始（第 41-48 周）
       * 天气炎热，所有学生获得：
       *   - 压力 -10
       *   - 学业成绩 +5（假期有更多时间复习文化课）
       *   - 体力恢复 +10
       */
      self.register({
        id: 'summer_vacation',
        name: '暑假开始',
        type: 'info',
        check: function (ctx) {
          return ctx.term && ctx.term.term === '暑假';
        },
        run: function (ctx) {
          var messages = ['暑假到了！天气炎热，注意防暑降温。'];
          var effects = [];

          for (var i = 0; i < ctx.students.length; i++) {
            var s = ctx.students[i];

            s.pressure = Math.max(0, (s.pressure || 0) - 10);
            s.academicScore = Math.min(100, (s.academicScore || 50) + 5);
            s.stamina = Math.min(s.maxStamina || 100, (s.stamina || 0) + 10);

            effects.push({
              student: s.name,
              pressure: -10,
              academic: 5,
              staminaRecovery: 10
            });
          }

          return { messages: messages, effects: effects };
        }
      });

      // ==================================================================
      // 3. 比赛临近提醒
      // ==================================================================

      /**
       * 比赛临近提醒
       * 在某场比赛的赛前一周（contest.week === ctx.week + 1）触发，
       * 提醒玩家做好备赛准备，并显示报名费信息。
       */
      self.register({
        id: 'contest_approaching',
        name: '比赛临近',
        type: 'info',
        check: function (ctx) {
          if (!window.REAL_CONTEST_SCHEDULE) return false;
          for (var i = 0; i < REAL_CONTEST_SCHEDULE.length; i++) {
            if (REAL_CONTEST_SCHEDULE[i].week === ctx.week + 1) {
              return true;
            }
          }
          return false;
        },
        run: function (ctx) {
          var messages = [];
          var effects = [];

          for (var i = 0; i < REAL_CONTEST_SCHEDULE.length; i++) {
            if (REAL_CONTEST_SCHEDULE[i].week === ctx.week + 1) {
              var c = REAL_CONTEST_SCHEDULE[i];
              messages.push(
                '下周将举行 ' + c.name +
                '（' + c.format + '赛制），请做好准备！'
              );
              // 有报名费时额外提示
              if (c.registrationFee > 0 && window.BudgetManager) {
                messages.push('  报名费：\u00a5' + c.registrationFee);
              }
            }
          }

          return { messages: messages, effects: effects };
        }
      });

      // ==================================================================
      // 4. 比赛报名（占位事件）
      // ==================================================================

      /**
       * 比赛报名
       * 当某场非必选比赛在本周举行时触发。
       * 此事件仅作为占位提示，实际报名逻辑由 contest-scheduler 模块处理，
       * 因此 run 返回 null，不会产生消息/效果。
       */
      self.register({
        id: 'contest_registration',
        name: '比赛报名',
        type: 'choice',
        check: function (ctx) {
          if (!window.REAL_CONTEST_SCHEDULE) return false;
          for (var i = 0; i < REAL_CONTEST_SCHEDULE.length; i++) {
            if (REAL_CONTEST_SCHEDULE[i].week === ctx.week &&
                !REAL_CONTEST_SCHEDULE[i].required) {
              return true;
            }
          }
          return false;
        },
        run: function (ctx) {
          // 实际报名逻辑由 contest-scheduler 处理
          return null;
        }
      });

      // ==================================================================
      // 5. 天气事件 — 恶劣天气
      // ==================================================================

      /**
       * 恶劣天气
       * 在冬季（一月/二月）或夏季（七月/八月）随机触发：
       *   - 冬季寒潮：10% 概率
       *   - 夏季高温：15% 概率
       * 效果：所有学生压力 +5
       */
      self.register({
        id: 'bad_weather',
        name: '恶劣天气',
        type: 'negative',
        check: function (ctx) {
          // 假期期间不触发天气事件
          if (ctx.isVacation) return false;

          var month = ctx.month;
          if (!month) return false;

          // 一月/二月 — 寒潮，10% 概率
          if ((month.month === '一月' || month.month === '二月') &&
              getRandom() < 0.10) {
            return true;
          }
          // 七月/八月 — 高温，15% 概率
          if ((month.month === '七月' || month.month === '八月') &&
              getRandom() < 0.15) {
            return true;
          }

          return false;
        },
        run: function (ctx) {
          var month = ctx.month;
          var isWinter = (month.month === '一月' || month.month === '二月');
          var msg = isWinter
            ? '寒潮来袭，气温骤降，学生们有些不适。'
            : '持续高温，训练效率下降，大家注意防暑。';

          var effects = [];

          for (var i = 0; i < ctx.students.length; i++) {
            var s = ctx.students[i];
            s.pressure = Math.min(100, (s.pressure || 0) + 5);
          }

          effects.push({ pressure: 5 });
          return { messages: [msg], effects: effects };
        }
      });

      // ==================================================================
      // 6. 生病事件
      // ==================================================================

      /**
       * 学生生病
       * 在学期中（非假期，且 week >= 3），每位学生有一定概率生病：
       *   - 体质 < 40：8% 概率
       *   - 体质 < 60：4% 概率
       *   - 体质 >= 60：2% 概率
       *
       * 生病效果：
       *   - sick_weeks += 2（生病持续 2 周，期间训练效果减半）
       *   - 体力 -20
       *
       * 注意：check 阶段通过掷骰确定受影响学生，结果缓存到模块变量
       *       _sickStudentIndices 中，run 阶段直接使用缓存结果，
       *       避免 check/run 分别掷骰导致不一致。
       */
      self.register({
        id: 'sickness',
        name: '学生生病',
        type: 'negative',
        check: function (ctx) {
          // 仅学期期间触发
          if (ctx.isVacation) return false;
          // 前 2 周不触发（刚开学）
          if (ctx.week < 3) return false;

          _sickStudentIndices = [];

          for (var i = 0; i < ctx.students.length; i++) {
            var s = ctx.students[i];
            var chance = 0.02; // 基础 2%

            if (s.physique < 40) {
              chance = 0.08;
            } else if (s.physique < 60) {
              chance = 0.04;
            }

            if (getRandom() < chance) {
              _sickStudentIndices.push(i);
            }
          }

          return _sickStudentIndices.length > 0;
        },
        run: function (ctx) {
          var messages = [];
          var effects = [];

          for (var j = 0; j < _sickStudentIndices.length; j++) {
            var s = ctx.students[_sickStudentIndices[j]];

            // 叠加生病周数
            s.sick_weeks = (s.sick_weeks || 0) + 2;
            // 体力扣除
            s.stamina = Math.max(0, (s.stamina || 0) - 20);

            messages.push(s.name + ' 生病了！需要休息 2 周，训练效果将受影响。');
            effects.push({
              student: s.name,
              sickWeeks: 2,
              stamina: -20
            });
          }

          return { messages: messages, effects: effects };
        }
      });

      // ==================================================================
      // 7. 体质优良事件
      // ==================================================================

      /**
       * 体质优良 — 体力恢复加成
       * 体质 >= 70 的学生有 10% 概率在本周获得额外体力恢复。
       * 与生病事件类似，check 阶段缓存受影响学生索引。
       */
      self.register({
        id: 'good_physique',
        name: '体质优良',
        type: 'positive',
        check: function (ctx) {
          // 假期期间不触发（假期已有统一恢复逻辑）
          if (ctx.isVacation) return false;

          _goodPhysiqueIndices = [];

          for (var i = 0; i < ctx.students.length; i++) {
            var s = ctx.students[i];
            if (s.physique >= 70 && getRandom() < 0.10) {
              _goodPhysiqueIndices.push(i);
            }
          }

          return _goodPhysiqueIndices.length > 0;
        },
        run: function (ctx) {
          var messages = [];
          var effects = [];

          for (var j = 0; j < _goodPhysiqueIndices.length; j++) {
            var s = ctx.students[_goodPhysiqueIndices[j]];

            // 额外恢复 5 点体力
            var before = s.stamina || 0;
            s.stamina = Math.min(s.maxStamina || 100, before + 5);
            var recovered = s.stamina - before;

            messages.push(
              s.name + ' 身体素质很好，本周额外恢复了 ' + recovered + ' 点体力。'
            );
            effects.push({
              student: s.name,
              staminaRecovery: recovered
            });
          }

          return { messages: messages, effects: effects };
        }
      });

      // ==================================================================
      // 8. 压力警告事件
      // ==================================================================

      /**
       * 压力过大
       * 当学生压力 >= 80 时，有 30% 概率触发警告。
       * 连续 4 周压力 >= 80 且触发警告，将出现崩溃退赛风险。
       *
       * 特殊性格交互：
       *   - 「自虐狂」隐藏性格：压力越高训练效果越好，且永不崩溃，
       *     因此不会产生压力警告。
       */
      self.register({
        id: 'pressure_warning',
        name: '压力过大',
        type: 'warning',
        check: function (ctx) {
          // 至少有一名学生压力极高才触发检测
          for (var i = 0; i < ctx.students.length; i++) {
            if (ctx.students[i].pressure >= 80) return true;
          }
          return false;
        },
        run: function (ctx) {
          var messages = [];
          var effects = [];

          for (var i = 0; i < ctx.students.length; i++) {
            var s = ctx.students[i];

            if (s.pressure >= 80) {
              // 30% 概率触发本轮警告
              if (getRandom() < 0.30) {
                // 「自虐狂」隐藏性格免疫压力警告
                if (window.PersonalityManager &&
                    PersonalityManager.hasHiddenPersonality(s, '自虐狂')) {
                  continue;
                }

                // 累计高压周数
                s.burnout_weeks = (s.burnout_weeks || 0) + 1;

                if (s.burnout_weeks >= 4) {
                  // 连续 4 周高压 → 崩溃退赛风险
                  messages.push(
                    s.name + ' 的压力持续极高，有崩溃退赛的风险！请立即安排休息！'
                  );
                } else {
                  // 普通警告
                  messages.push(
                    s.name + ' 的压力过大（' + Math.floor(s.pressure) +
                    '），建议适当安排运动或休息来减压。'
                  );
                }

                effects.push({
                  student: s.name,
                  burnoutWeeks: s.burnout_weeks,
                  pressureLevel: Math.floor(s.pressure)
                });
              }
            }
          }

          // 如果没有产生任何消息，返回 null 避免空事件
          if (messages.length === 0) return null;

          return { messages: messages, effects: effects };
        }
      });

      // ==================================================================
      // 9. 声誉奖励事件
      // ==================================================================

      /**
       * 声誉带来机会
       * 当教练声誉 >= 70 时，有 10% 概率获得额外赞助资金。
       * 奖金范围：\u00a51,000 ~ \u00a53,000。
       */
      self.register({
        id: 'reputation_reward',
        name: '声誉带来机会',
        type: 'positive',
        check: function (ctx) {
          return (ctx.game && ctx.game.reputation >= 70 && getRandom() < 0.10);
        },
        run: function (ctx) {
          // 随机奖金 1000~3000
          var bonus = Math.floor(1000 + getRandom() * 2000);

          // 通过 BudgetManager 入账
          if (window.BudgetManager && typeof BudgetManager.receive === 'function') {
            BudgetManager.receive(bonus, '声誉奖金', ctx.week);
          }

          return {
            messages: ['高声誉带来了额外的赞助资金！+\u00a5' + bonus],
            effects: [{ budget: bonus }]
          };
        }
      });

      // ==================================================================\n      // 10. 企业赞助事件
      // ==================================================================
      /**
       * 企业赞助
       * 声誉 >= 30，第8-45周，4% 概率
       * 获得 ¥15,000~40,000，声誉 +3
       */
      self.register({
        id: 'corporate_sponsorship',
        name: '企业赞助',
        type: 'positive',
        check: function (ctx) {
          if (!ctx.game) return false;
          if (ctx.game.reputation < 30) return false;
          if (ctx.week < 8 || ctx.week > 92) return false;
          if (ctx.isVacation) return false;
          return getRandom() < 0.04;
        },
        run: function (ctx) {
          var gain = Math.floor(15000 + Math.random() * 25000);
          ctx.game.reputation = Math.min(100, ctx.game.reputation + 3);
          if (window.BudgetManager) {
            BudgetManager.receive(gain, '企业赞助', ctx.week);
          }
          return {
            messages: [
              '一家科技公司联系到你的集训队，希望赞助信息学教育项目。',
              '获得企业赞助 \u00a5' + gain.toLocaleString() + '，声誉提升 +3。'
            ],
            effects: [{ budget: gain, reputation: 3 }]
          };
        }
      });

      // ==================================================================\n      // 11. 上级拨款事件
      // ==================================================================
      /**
       * 上级拨款
       * 比赛结束后 3 周内，8% 概率触发
       * 获得 ¥5,000~15,000，声誉 +2
       */
      self.register({
        id: 'funding_allocation',
        name: '上级拨款',
        type: 'positive',
        check: function (ctx) {
          if (!ctx.game) return false;
          if (ctx.week < 5) return false;
          if (!ctx.game.completedCompetitions) return false;
          // 检查最近3周是否有已完成的比赛
          for (var w = ctx.week - 3; w < ctx.week; w++) {
            if (w < 1) continue;
            if (window.REAL_CONTEST_SCHEDULE) {
              for (var i = 0; i < REAL_CONTEST_SCHEDULE.length; i++) {
                var c = REAL_CONTEST_SCHEDULE[i];
                var cKey = c.id + '_' + w;
                if (c.week === w && ctx.game.completedCompetitions.has(cKey)) {
                  return getRandom() < 0.08;
                }
              }
            }
          }
          return false;
        },
        run: function (ctx) {
          var gain = Math.floor(5000 + Math.random() * 10000);
          ctx.game.reputation = Math.min(100, ctx.game.reputation + 2);
          if (window.BudgetManager) {
            BudgetManager.receive(gain, '上级拨款', ctx.week);
          }
          return {
            messages: [
              '上级部门对集训队近期的比赛成绩表示认可，追加拨付一笔经费。',
              '收到上级拨款 \u00a5' + gain.toLocaleString() + '，声誉提升 +2。'
            ],
            effects: [{ budget: gain, reputation: 2 }]
          };
        }
      });

      // ==================================================================\n      // 12. 校友捐赠事件
      // ==================================================================
      /**
       * 校友捐赠
       * 声誉 >= 50，第12-40周，3% 概率
       * 获得 ¥3,000~10,000
       */
      self.register({
        id: 'alumni_donation',
        name: '校友捐赠',
        type: 'positive',
        check: function (ctx) {
          if (!ctx.game) return false;
          if (ctx.game.reputation < 50) return false;
          if (ctx.week < 12 || ctx.week > 88) return false;
          if (ctx.isVacation) return false;
          return getRandom() < 0.03;
        },
        run: function (ctx) {
          var gain = Math.floor(3000 + Math.random() * 7000);
          if (window.BudgetManager) {
            BudgetManager.receive(gain, '校友捐赠', ctx.week);
          }
          return {
            messages: [
              '一位曾从集训队走出的校友发来消息，表示愿意资助学弟学妹。',
              '收到校友捐赠 \u00a5' + gain.toLocaleString() + '。'
            ],
            effects: [{ budget: gain }]
          };
        }
      });

      // ==================================================================
      // 13. 学校专项经费
      // ==================================================================
      /**
       * 学校专项经费
       * 期中节点（第15周、第38周），声誉 >= 20 时确定性触发
       * 获得 ¥8,000~20,000
       */
      self.register({
        id: 'school_subsidy',
        name: '学校专项经费',
        type: 'positive',
        check: function (ctx) {
          if (!ctx.game) return false;
          if (ctx.game.reputation < 20) return false;
          return ctx.week === 15 || ctx.week === 38 || ctx.week === 63 || ctx.week === 86;
        },
        run: function (ctx) {
          var gain = Math.floor(8000 + Math.random() * 12000);
          if (window.BudgetManager) {
            BudgetManager.receive(gain, '学校专项经费', ctx.week);
          }
          return {
            messages: [
              '学校信息学竞赛专项经费到账，用于支持本学期集训队运营。',
              '获得学校专项经费 \u00a5' + gain.toLocaleString() + '。'
            ],
            effects: [{ budget: gain }]
          };
        }
      });

      // ==================================================================
      // 14. 培训班收入
      // ==================================================================
      /**
       * 培训班收入
       * 声誉 >= 35，第5-48周，5% 概率
       * 教练利用周末开设短期培训班，获得 ¥2,000~6,000
       */
      self.register({
        id: 'training_class_income',
        name: '培训班收入',
        type: 'positive',
        check: function (ctx) {
          if (!ctx.game) return false;
          if (ctx.game.reputation < 35) return false;
          if (ctx.week < 5 || ctx.week > 92) return false;
          if (ctx.isVacation) return false;
          return getRandom() < 0.05;
        },
        run: function (ctx) {
          var gain = Math.floor(2000 + Math.random() * 4000);
          if (window.BudgetManager) {
            BudgetManager.receive(gain, '培训班收入', ctx.week);
          }
          return {
            messages: [
              '周末开办了一期短期信息学培训班，反响不错。',
              '培训班收入 \u00a5' + gain.toLocaleString() + '。'
            ],
            effects: [{ budget: gain }]
          };
        }
      });

      // ==================================================================\n      // 15. 学生突破事件
      // ==================================================================
      /**
       * 学生突破
       * 第8周后，随机一名学生，5% 概率
       * 该学生思维 +2~4，编码 +2~4
       */
      var _breakthroughStudentIdx = -1;
      self.register({
        id: 'student_breakthrough',
        name: '学生突破',
        type: 'positive',
        check: function (ctx) {
          if (ctx.isVacation) return false;
          if (ctx.week < 8) return false;
          if (ctx.students.length === 0) return false;
          _breakthroughStudentIdx = -1;
          if (getRandom() < 0.05) {
            _breakthroughStudentIdx = Math.floor(Math.random() * ctx.students.length);
            return true;
          }
          return false;
        },
        run: function (ctx) {
          var idx = _breakthroughStudentIdx;
          if (idx < 0 || idx >= ctx.students.length) return null;
          var s = ctx.students[idx];
          if (!s || s.active === false) return null;

          var tGain = Math.floor(2 + Math.random() * 3);
          var cGain = Math.floor(2 + Math.random() * 3);
          s.thinking = (s.thinking || 0) + tGain;
          s.coding = (s.coding || 0) + cGain;

          return {
            messages: [
              s.name + ' 在做题时突然领悟了一种新的思维方式！',
              '思维 +' + tGain + '，编码 +' + cGain + '。'
            ],
            effects: [{ student: s.name, thinking: tGain, coding: cGain }]
          };
        }
      });

      // ==================================================================
      // 16. 网赛获奖事件
      // ==================================================================
      /**
       * 网赛获奖
       * 声誉 >= 25，第5周后，6% 概率
       * 获得 ¥500~2,000，声誉 +1~3
       */
      self.register({
        id: 'online_contest_award',
        name: '网赛获奖',
        type: 'positive',
        check: function (ctx) {
          if (!ctx.game) return false;
          if (ctx.game.reputation < 25) return false;
          if (ctx.week < 5) return false;
          if (ctx.isVacation) return false;
          return getRandom() < 0.06;
        },
        run: function (ctx) {
          var gain = Math.floor(500 + Math.random() * 1500);
          var repGain = Math.floor(1 + Math.random() * 3);
          ctx.game.reputation = Math.min(100, ctx.game.reputation + repGain);
          if (window.BudgetManager) {
            BudgetManager.receive(gain, '网赛奖金', ctx.week);
          }
          var contestNames = ['AtCoder ABC', 'Codeforces Div.2', '洛谷月赛', '牛客周赛'];
          var cName = contestNames[Math.floor(Math.random() * contestNames.length)];
          return {
            messages: [
              '学生们在 ' + cName + ' 中取得了不错的成绩！',
              '获得奖金 \u00a5' + gain.toLocaleString() + '，声誉 +' + repGain + '。'
            ],
            effects: [{ budget: gain, reputation: repGain }]
          };
        }
      });

      // ==================================================================\n      // 17. 晴好天气事件
      // ==================================================================
      /**
       * 晴好天气
       * 春秋季节（四月/五月/九月/十月），10% 概率
       * 所有学生压力 -3，体力 +3
       */
      self.register({
        id: 'good_weather_blessing',
        name: '晴好天气',
        type: 'positive',
        check: function (ctx) {
          if (ctx.isVacation) return false;
          var month = ctx.month;
          if (!month) return false;
          var goodMonths = ['四月', '五月', '九月', '十月'];
          for (var i = 0; i < goodMonths.length; i++) {
            if (month.month === goodMonths[i]) return getRandom() < 0.10;
          }
          return false;
        },
        run: function (ctx) {
          for (var i = 0; i < ctx.students.length; i++) {
            var s = ctx.students[i];
            s.pressure = Math.max(0, (s.pressure || 0) - 3);
            s.stamina = Math.min(s.maxStamina || 100, (s.stamina || 0) + 3);
          }
          return {
            messages: [
              '本周天气晴好，阳光明媚，学生们的心情也格外舒畅。',
              '全体学生压力 -3，体力 +3。'
            ],
            effects: [{ pressure: -3, stamina: 3 }]
          };
        }
      });

      // ==================================================================
      // 18. 免费学习资源事件
      // ==================================================================
      /**
       * 免费学习资源
       * 第6周后，4% 概率
       * 所有学生各知识点 +1~2
       */
      self.register({
        id: 'free_resources',
        name: '免费学习资源',
        type: 'positive',
        check: function (ctx) {
          if (ctx.week < 6) return false;
          if (ctx.isVacation) return false;
          return getRandom() < 0.04;
        },
        run: function (ctx) {
          var boost = Math.floor(1 + Math.random() * 2);
          var types = ['knowledge_ds', 'knowledge_graph', 'knowledge_string', 'knowledge_math', 'knowledge_dp'];
          for (var i = 0; i < ctx.students.length; i++) {
            var s = ctx.students[i];
            for (var t = 0; t < types.length; t++) {
              s[types[t]] = (s[types[t]] || 0) + boost;
            }
          }
          var platforms = ['洛谷题单', 'Codeforces EDU', 'OI Wiki 更新', 'YouTube 算法课'];
          var plat = platforms[Math.floor(Math.random() * platforms.length)];
          return {
            messages: [
              plat + ' 开放了免费优质内容，学生们积极学习。',
              '全体学生各知识点 +' + boost + '。'
            ],
            effects: [{ knowledge: boost }]
          };
        }
      });

      // ==================================================================
      // 19. 同学互助事件
      // ==================================================================
      /**
       * 同学互助
       * >= 3 名活跃学生，5% 概率
       * 知识最弱的学生获得较大知识提升
       */
      self.register({
        id: 'peer_teaching',
        name: '同学互助',
        type: 'positive',
        check: function (ctx) {
          if (ctx.isVacation) return false;
          if (ctx.week < 5) return false;
          var activeCount = 0;
          for (var i = 0; i < ctx.students.length; i++) {
            if (ctx.students[i] && ctx.students[i].active !== false) activeCount++;
          }
          return activeCount >= 3 && getRandom() < 0.05;
        },
        run: function (ctx) {
          // 找到知识总量最低的 2 名活跃学生
          var activeList = [];
          for (var i = 0; i < ctx.students.length; i++) {
            var s = ctx.students[i];
            if (s && s.active !== false) activeList.push(s);
          }
          activeList.sort(function (a, b) {
            var ka = (a.knowledge_ds||0)+(a.knowledge_graph||0)+(a.knowledge_string||0)+(a.knowledge_math||0)+(a.knowledge_dp||0);
            var kb = (b.knowledge_ds||0)+(b.knowledge_graph||0)+(b.knowledge_string||0)+(b.knowledge_math||0)+(b.knowledge_dp||0);
            return ka - kb;
          });
          var types = ['knowledge_ds', 'knowledge_graph', 'knowledge_string', 'knowledge_math', 'knowledge_dp'];
          var names = [];
          var count = Math.min(2, activeList.length);
          for (var j = 0; j < count; j++) {
            var s = activeList[j];
            var boost = Math.floor(2 + Math.random() * 3);
            for (var t = 0; t < types.length; t++) {
              s[types[t]] = (s[types[t]] || 0) + boost;
            }
            names.push(s.name);
          }
          return {
            messages: [
              '学生们自发组织了互助学习小组，基础较弱的同学受益匪浅。',
              names.join('、') + ' 各知识点获得较大提升。'
            ],
            effects: [{ students: names }]
          };
        }
      });

      // ==================================================================\n      // 20. 训练瓶颈事件
      // ==================================================================
      /**
       * 训练瓶颈
       * 第10周后，4% 概率，随机一名学生
       * 该学生压力 +8，本周训练效率下降
       */
      var _plateauStudentIdx = -1;
      self.register({
        id: 'training_plateau',
        name: '训练瓶颈',
        type: 'negative',
        check: function (ctx) {
          if (ctx.isVacation) return false;
          if (ctx.week < 10) return false;
          if (ctx.students.length === 0) return false;
          _plateauStudentIdx = -1;
          if (getRandom() < 0.04) {
            _plateauStudentIdx = Math.floor(Math.random() * ctx.students.length);
            return true;
          }
          return false;
        },
        run: function (ctx) {
          var idx = _plateauStudentIdx;
          if (idx < 0 || idx >= ctx.students.length) return null;
          var s = ctx.students[idx];
          if (!s || s.active === false) return null;

          s.pressure = Math.min(100, (s.pressure || 0) + 8);
          s._plateau_week = ctx.week; // 标记瓶颈周

          return {
            messages: [
              s.name + ' 最近做题总是卡壳，似乎进入了训练瓶颈期。',
              '压力 +8，建议适当调整训练内容或安排休息。'
            ],
            effects: [{ student: s.name, pressure: 8 }]
          };
        }
      });

      // ==================================================================\n      // 21. 学生矛盾事件
      // ==================================================================
      /**
       * 学生矛盾
       * >= 3 名活跃学生，3% 概率
       * 随机两名学生压力 +10
       */
      var _conflictIndices = [];
      self.register({
        id: 'student_conflict',
        name: '学生矛盾',
        type: 'negative',
        check: function (ctx) {
          if (ctx.isVacation) return false;
          if (ctx.week < 5) return false;
          var activeCount = 0;
          for (var i = 0; i < ctx.students.length; i++) {
            if (ctx.students[i] && ctx.students[i].active !== false) activeCount++;
          }
          _conflictIndices = [];
          if (activeCount >= 3 && getRandom() < 0.03) {
            // 随机选 2 名活跃学生
            var activeIdx = [];
            for (var i = 0; i < ctx.students.length; i++) {
              if (ctx.students[i] && ctx.students[i].active !== false) activeIdx.push(i);
            }
            for (var j = 0; j < 2 && j < activeIdx.length; j++) {
              var ri = Math.floor(Math.random() * activeIdx.length);
              _conflictIndices.push(activeIdx[ri]);
              activeIdx.splice(ri, 1);
            }
            return _conflictIndices.length >= 2;
          }
          return false;
        },
        run: function (ctx) {
          var names = [];
          for (var j = 0; j < _conflictIndices.length; j++) {
            var s = ctx.students[_conflictIndices[j]];
            s.pressure = Math.min(100, (s.pressure || 0) + 10);
            names.push(s.name);
          }
          return {
            messages: [
              names.join(' 和 ') + ' 因为训练资源分配问题产生了摩擦。',
              '双方压力各 +10，建议及时调解。'
            ],
            effects: [{ students: names, pressure: 10 }]
          };
        }
      });

      // ==================================================================\n      // 22. 设备故障事件
      // ==================================================================
      /**
       * 设备故障
       * 第5周后，2% 概率
       * 需要 ¥2,000~5,000 维修费
       */
      self.register({
        id: 'equipment_failure',
        name: '设备故障',
        type: 'negative',
        check: function (ctx) {
          if (ctx.week < 5) return false;
          if (ctx.isVacation) return false;
          return getRandom() < 0.02;
        },
        run: function (ctx) {
          var cost = Math.floor(2000 + Math.random() * 3000);
          if (window.BudgetManager) {
            BudgetManager.spend(cost, '设备维修', ctx.week);
          }
          return {
            messages: [
              '机房的部分设备出现故障，需要紧急维修。',
              '维修费用 \u00a5' + cost.toLocaleString() + '。'
            ],
            effects: [{ budget: -cost }]
          };
        }
      });

      // ==================================================================
      // 23. 文化课考试压力
      // ==================================================================
      /**
       * 文化课考试压力
       * 学期期间（非假期），4% 概率
       * 所有学生压力 +5，文化课 < 60 的学生额外 +5
       */
      self.register({
        id: 'academic_exam_pressure',
        name: '文化课考试压力',
        type: 'negative',
        check: function (ctx) {
          if (ctx.isVacation) return false;
          if (ctx.week < 6) return false;
          return getRandom() < 0.04;
        },
        run: function (ctx) {
          var extraCount = 0;
          for (var i = 0; i < ctx.students.length; i++) {
            var s = ctx.students[i];
            s.pressure = Math.min(100, (s.pressure || 0) + 5);
            if ((s.academicScore || 50) < 60) {
              s.pressure = Math.min(100, s.pressure + 5);
              extraCount++;
            }
          }
          var msg = '学校即将举行文化课考试，集训队学生也感受到了压力。';
          if (extraCount > 0) {
            msg += ' 有 ' + extraCount + ' 名学生因为文化课基础薄弱，压力额外增加。';
          }
          return {
            messages: [msg],
            effects: [{ pressure: 5 }]
          };
        }
      });

      // ==================================================================
      // 24. 家长投诉事件
      // ==================================================================
      /**
       * 家长投诉
       * 有学生压力 >= 75 时，3% 概率
       * 声誉 -3
       */
      self.register({
        id: 'parent_complaint',
        name: '家长投诉',
        type: 'negative',
        check: function (ctx) {
          if (!ctx.game) return false;
          if (ctx.week < 5) return false;
          var hasHighPressure = false;
          for (var i = 0; i < ctx.students.length; i++) {
            if ((ctx.students[i].pressure || 0) >= 75) {
              hasHighPressure = true;
              break;
            }
          }
          return hasHighPressure && getRandom() < 0.03;
        },
        run: function (ctx) {
          ctx.game.reputation = Math.max(0, (ctx.game.reputation || 0) - 3);
          return {
            messages: [
              '一位家长向学校反映，认为集训队训练强度过大，影响了孩子的身心健康。',
              '声誉 -3。请注意关注学生压力状况。'
            ],
            effects: [{ reputation: -3 }]
          };
        }
      });

      // ==================================================================
      // 25. 比赛奖金事件（确定性，比赛周后一周触发）
      // ==================================================================
      /**
       * 比赛奖金发放
       * 当上一周有比赛完成时确定性触发
       * 根据奖牌等级发放奖金
       */
      self.register({
        id: 'contest_prize',
        name: '比赛奖金',
        type: 'positive',
        check: function (ctx) {
          if (!ctx.game) return false;
          if (!ctx.game.careerCompetitions || ctx.game.careerCompetitions.length === 0) return false;
          var lastComp = ctx.game.careerCompetitions[ctx.game.careerCompetitions.length - 1];
          return lastComp && lastComp.week === ctx.week - 1;
        },
        run: function (ctx) {
          var lastComp = ctx.game.careerCompetitions[ctx.game.careerCompetitions.length - 1];
          if (!lastComp || lastComp.week !== ctx.week - 1) return null;

          var compName = lastComp.name || '比赛';
          var results = lastComp.results || [];
          var goldCount = 0, silverCount = 0, bronzeCount = 0;
          var totalReward = 0;

          for (var i = 0; i < results.length; i++) {
            var medal = results[i].medal;
            var reward = 0;
            if (medal === 'gold') {
              goldCount++;
              reward = Math.floor(20000 + Math.random() * 20000); // ¥20k-40k
            } else if (medal === 'silver') {
              silverCount++;
              reward = Math.floor(10000 + Math.random() * 10000); // ¥10k-20k
            } else if (medal === 'bronze') {
              bronzeCount++;
              reward = Math.floor(5000 + Math.random() * 5000);   // ¥5k-10k
            }
            totalReward += reward;
          }

          if (totalReward <= 0) return null;

          if (window.BudgetManager) {
            BudgetManager.receive(totalReward, compName + ' 奖金', ctx.week);
          }

          var detail = [];
          if (goldCount > 0) detail.push('金牌 x' + goldCount);
          if (silverCount > 0) detail.push('银牌 x' + silverCount);
          if (bronzeCount > 0) detail.push('铜牌 x' + bronzeCount);

          return {
            messages: [
              compName + ' 的奖金已发放！',
              detail.join('，') + '，共 \u00a5' + totalReward.toLocaleString() + '。'
            ],
            effects: [{ budget: totalReward }]
          };
        }
      });

      // ==================================================================
      // 26. 台风事件
      // ==================================================================
      /**
       * 台风
       * 台风季节（7月-9月），5% 概率触发
       * 效果：
       *   - 经费损失 ¥3,000~10,000
       *   - 当周无法行动（除了正式赛）
       *   - 所有学生压力 +10
       * 天赋联动：
       *   - 「追风者」天赋：台风时压力清零
       */
      self.register({
        id: 'typhoon',
        name: '台风',
        type: 'negative',
        check: function (ctx) {
          if (!ctx.game) return false;
          var w = ctx.week;
          // 台风季节：7-9月
          // Year 1: weeks 41-48 (七月-八月), Year 2: weeks 89-96 (七月-八月)
          // Also include September: Year 2 weeks 49-52 (九月初)
          var isTyphoonSeason = false;
          if (w >= 41 && w <= 48) isTyphoonSeason = true;  // Year 1 七月-八月
          if (w >= 89 && w <= 96) isTyphoonSeason = true;  // Year 2 七月-八月
          if (w >= 49 && w <= 52) isTyphoonSeason = true;  // Year 2 九月初
          if (!isTyphoonSeason) return false;
          return getRandom() < 0.05;
        },
        run: function (ctx) {
          var loss = Math.floor(3000 + Math.random() * 7000);
          if (window.BudgetManager) {
            BudgetManager.spend(loss, '台风损失', ctx.week);
          }

          // 标记当周为台风周（禁止行动，但正式赛不受影响）
          if (ctx.game) {
            ctx.game.typhoonWeek = true;
          }

          // 所有学生压力 +10
          for (var i = 0; i < ctx.students.length; i++) {
            var s = ctx.students[i];
            s.pressure = Math.min(100, (s.pressure || 0) + 10);

            // 追风者天赋联动：台风时压力清零
            if (s.triggerTalents) {
              s.triggerTalents('pressure_change', { source: 'typhoon' });
            }
          }

          return {
            messages: [
              '台风来袭！狂风暴雨导致训练设施受损，本周无法正常行动。',
              '损失 \u00a5' + loss.toLocaleString() + '，全体学生压力 +10。',
              '（正式比赛不受影响，有「追风者」天赋的学生压力清零）'
            ],
            effects: [{ budget: -loss, pressure: 10 }]
          };
        }
      });

    }, // end _registerDefaultEvents

    /* ------------------------------------------------------------------
     * 调试工具
     * ------------------------------------------------------------------ */

    /**
     * 输出事件系统摘要到控制台（调试用）
     */
    debugSummary: function () {
      console.log(
        '[RealEventManager] 已注册 ' + this._events.length + ' 个事件：'
      );
      for (var i = 0; i < this._events.length; i++) {
        var evt = this._events[i];
        console.log(
          '  [' + evt.type + '] ' + evt.id + ' — ' + evt.name
        );
      }
    }

  }; // end RealEventManager

  /* ========================================================================
   * 导出到全局
   * ======================================================================== */
  global.RealEventManager = RealEventManager;

  /* ========================================================================
   * 加载完成提示（开发阶段使用，上线后可移除）
   * ======================================================================== */
  if (typeof console !== 'undefined') {
    console.log('[Real Mode] real-events.js 加载完成');
  }

})(typeof window !== 'undefined' ? window : this);
