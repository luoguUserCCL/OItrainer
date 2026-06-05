/* ==========================================================================
 * real-render.js — OItrainer Real Mode 渲染模块
 * --------------------------------------------------------------------------
 * 提供 window.RealRender 对象，负责所有 UI 渲染和交互逻辑。
 * 与简化模式 (render.js) 使用相同的 class 名和视觉风格。
 *
 * ES5 语法（var, function, 无箭头函数、无 let/const）。
 * 所有全局挂载使用 window.* 前缀。
 *
 * 新增特性：每次行动都需要确认才能执行。
 *
 * 依赖模块：
 *   window.RealGame, window.RealCalendar, window.PersonalityManager
 *   window.BudgetManager, window.RealSaveManager, window.RealTraining
 *   window.RealContestEngine, window.REAL_CONTEST_SCHEDULE
 *   window.REAL_TASK_POOL, window.CONTEST_FORMATS
 *   window.Student, window.Facilities
 *   window.getDifficultyLabel, window.KNOWLEDGE_POINTS, window.generateName
 * ========================================================================== */

(function () {
  'use strict';

  window.RealRender = {

    /* ==================== 内部状态 ==================== */
    _modalOpen: false,
    _simulator: null,
    _contestTimer: null,
    _actionCount: 0,
    _currentTasks: null,
    _selectedTask: null,
    _selectedIntensity: 1,

    /* ========================================================================
     * 第 1 节：初始化与主渲染
     * ======================================================================== */

    init: function () {
      this._bindEvents();
      this.renderAll();
    },

    renderAll: function () {
      if (!window.RealGame || !window.RealGame.state) return;
      var state = window.RealGame.state;
      this._renderHeader(state);
      this._renderStudents(state);
      this._renderActions(state);
      this._renderContestSchedule(state);
      this._renderBudget(state);
      this._renderFacilities(state);
      this._renderEventLog(state);
      if (state.gameOver) {
        this._renderGameOver(state);
      }
    },

    /* ========================================================================
     * 第 2 节：Header 渲染（使用简化模式结构）
     * ======================================================================== */

    _renderHeader: function (state) {
      var el = document.getElementById('header-week');
      if (el) {
        el.innerText = window.RealCalendar.formatWeek(state.week);
      }

      var budgetEl = document.getElementById('header-budget');
      if (budgetEl) {
        budgetEl.innerText = '经费: ' + window.BudgetManager.formatFunds();
        if (window.BudgetManager.getFunds() < 5000) {
          budgetEl.classList.add('low-funds');
        } else {
          budgetEl.classList.remove('low-funds');
        }
      }

      var repEl = document.getElementById('header-reputation');
      if (repEl) { repEl.innerText = '声誉: ' + state.reputation; }

      var weatherEl = document.getElementById('header-weather');
      if (weatherEl) {
        weatherEl.innerText = '天气: ' + (state.weather || '晴') + ' ' + (state.temperature || 25) + '°C';
      }

      var nextEl = document.getElementById('header-next-comp-small');
      if (nextEl) {
        var nc = window.RealGame.getNextContest();
        nextEl.innerText = nc ? ('下场比赛: ' + nc.contest.name + ' (' + nc.weeksAway + '周后)') : '下场比赛: 无';
        if (nc) { nextEl.classList.add('next-contest'); }
        else { nextEl.classList.remove('next-contest'); }
      }
    },

    /* ========================================================================
     * 第 3 节：学生列表渲染（使用简化模式 student-box 结构）
     * ======================================================================== */

    _renderStudents: function (state) {
      var el = document.getElementById('student-list');
      if (!el) return;

      var totalInitial = state.initial_students || 0;
      var totalQuit    = state.quit_students || 0;
      var totalEver    = totalInitial + totalQuit;

      var out = '';
      for (var i = 0; i < state.students.length; i++) {
        var s = state.students[i];
        if (s.active === false) continue;

        var personality = null;
        if (window.PersonalityManager && typeof window.PersonalityManager.getPersonality === 'function') {
          personality = window.PersonalityManager.getPersonality(s.personality);
        }

        var pressureLevel = s.pressure < 35 ? '低' : s.pressure < 65 ? '中' : '高';
        var pressureClass = s.pressure < 35 ? 'pressure-low' : s.pressure < 65 ? 'pressure-mid' : 'pressure-high';
        var pressureValue = Math.floor(s.pressure);
        var genderIcon = (s.gender === 'female') ? '♀' : '♂';
        var maxStamina = s.maxStamina || 100;
        var staminaPct = Math.floor(s.stamina / maxStamina * 100);

        /* 天赋徽章 */
        var talentsHtml = '';
        if (s.talents) {
          var talentArray = [];
          if (typeof s.talents.values === 'function') {
            var it = s.talents.values();
            var r = it.next();
            while (!r.done) { talentArray.push(r.value); r = it.next(); }
          } else if (Array.isArray(s.talents)) {
            talentArray = s.talents.slice();
          }
          for (var ti = 0; ti < talentArray.length; ti++) {
            var tName = talentArray[ti];
            var tInfo = (window.TalentManager && window.TalentManager.getTalentInfo) ?
              window.TalentManager.getTalentInfo(tName) : { name: tName, description: '暂无描述', color: '#2b6cb0' };
            talentsHtml += '<span class="talent-tag" data-talent="' + tName + '" style="background-color: ' + tInfo.color + '20; color: ' + tInfo.color + '; border-color: ' + tInfo.color + '40;">' +
              tName +
              '<span class="talent-tooltip">' + (tInfo.description || '') + '</span></span>';
          }
        }

        /* 知识点徽章（与简化模式一致的 .kb 样式） */
        var knowledgeHtml = '<div class="knowledge-badges">';
        var areas    = ['knowledge_ds', 'knowledge_graph', 'knowledge_string', 'knowledge_math', 'knowledge_dp'];
        var areaNames = ['数据结构', '图论', '字符串', '数学', 'DP'];
        var areaShort = ['DS', '图', '字', '数', 'DP'];
        for (var j = 0; j < areas.length; j++) {
          var val     = s[areas[j]] || 0;
          var grade   = window.getLetterGradeAbility ? window.getLetterGradeAbility(Math.floor(val)) : '?';
          knowledgeHtml += '<span class="kb" title="' + areaNames[j] + ': ' + Math.floor(val) + '" data-grade="' + grade + '">' +
            areaShort[j] + ' ' + grade + '</span>';
        }
        /* 能力徽章 */
        knowledgeHtml += '<span class="kb ability" title="思维: ' + Math.floor(s.thinking) + '" data-grade="' +
          (window.getLetterGradeAbility ? window.getLetterGradeAbility(Math.floor(s.thinking)) : '?') + '">思维' +
          (window.getLetterGradeAbility ? window.getLetterGradeAbility(Math.floor(s.thinking)) : '?') + '</span>';
        knowledgeHtml += '<span class="kb ability" title="代码: ' + Math.floor(s.coding) + '" data-grade="' +
          (window.getLetterGradeAbility ? window.getLetterGradeAbility(Math.floor(s.coding)) : '?') + '">代码' +
          (window.getLetterGradeAbility ? window.getLetterGradeAbility(Math.floor(s.coding)) : '?') + '</span>';
        knowledgeHtml += '</div>';

        /* 体力状态 */
        var staminaColor = staminaPct > 60 ? '#34d399' : (staminaPct > 30 ? '#fbbf24' : '#f87171');

        out += '<div class="student-box" data-name="' + s.name + '">' +
          '<button class="evict-btn" data-name="' + s.name.replace(/"/g, '&quot;') + '" title="辞退">辞退</button>' +
          '<div class="student-header">' +
            '<div class="student-name">' +
              s.name +
              (s.sick_weeks > 0 ? ' <span class="warn">[生病]</span>' : '') +
              (genderIcon === '♀' ? ' ♀' : ' ♂') +
              (personality ?
                '<span class="personality-badge" title="' +
                  (personality.description || s.personality) + '">' + s.personality + '</span>' : '') +
            '</div>' +
            '<div class="student-status">' +
              '<span class="label-pill ' + pressureClass + '">压力: ' + pressureLevel + '(' + pressureValue + ')</span>' +
            '</div>' +
          '</div>' +
          '<div class="student-details" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">' +
            '<div style="display:flex;align-items:center;gap:6px;">' +
              '<span style="font-size:12px;color:#718096;font-weight:600;">知识</span>' +
              knowledgeHtml +
            '</div>' +
            (talentsHtml ?
              '<div style="display:flex;align-items:center;gap:6px;">' +
              '<span style="font-size:12px;color:#718096;font-weight:600;">天赋</span>' +
              '<div class="student-talents">' + talentsHtml + '</div>' +
            '</div>' : '') +
          '</div>' +
          /* 额外属性行 */
          '<div class="student-info-row" style="display:flex;gap:10px;margin-top:4px;">' +
            '<span class="info-label">体力</span>' +
            '<span class="info-value" style="color:' + staminaColor + '">' +
              Math.floor(s.stamina) + '/' + maxStamina + '</span>' +
          '</div>' +
          '<div class="student-info-row" style="display:flex;gap:10px;">' +
            '<span class="info-label">文化课</span>' +
            '<span class="info-value">' + Math.floor(s.academicScore || 50) + '</span>' +
          '</div>' +
        '</div>';
      } /* end for students */

      el.innerHTML = out;

      if (out === '') {
        el.innerHTML = '<div class="muted">目前没有活跃学生</div>';
      }

      /* 绑定辞退事件 */
      if (!el._evictDelegated) {
        el._evictDelegated = true;
        el.addEventListener('click', function (e) {
          var btn = e.target.closest('.evict-btn');
          if (!btn) return;
          var name = btn.dataset.name;
          if (!name) return;
          if (!confirm('确认辞退 ' + name + '？')) return;
          window.RealGame.dismissStudent(name);
          window.RealRender.renderAll();
        });
      }
    },

    /* ========================================================================
     * 第 4 节：操作面板渲染（使用简化模式 action-card 结构）
     * ======================================================================== */

    _renderActions: function (state) {
      var el = document.getElementById('actions-panel');
      if (!el) return;

      var html = '';

      /* 比赛周模式：只显示比赛卡片 */
      var contestsThisWeek = window.RealCalendar.getContestsAtWeek(state.week);
      var compNow = null;
      if (contestsThisWeek && contestsThisWeek.length > 0) {
        for (var ci = 0; ci < contestsThisWeek.length; ci++) {
          var c = contestsThisWeek[ci];
          var compKey = c.id + '_' + state.week;
          var completed = state.completedCompetitions &&
            (typeof state.completedCompetitions.has === 'function') &&
            state.completedCompetitions.has(compKey);
          if (!completed) {
            compNow = c;
            break;
          }
        }
      }

      /* ====== 消耗类行动（占用本周行动机会） ====== */
      html += '<div style="font-size:12px;color:#718096;margin:8px 0 4px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">消耗类行动（占用本周行动）</div>';

      if (!state.actionTakenThisWeek) {
        /* 比赛周优先显示正式赛卡片 */
        if (compNow) {
          html += '<div class="action-taken-notice" style="margin:4px 0 8px;padding:6px 8px;background:#fffbeb;border:1px solid #f6e05e;border-radius:6px;color:#975a16;font-size:13px;">本周有比赛</div>';
          html += '<div class="action-card comp-highlight" id="comp-only-action" onclick="RealRender.showContestSelection(\'' +
            compNow.id + '\')">' +
            '<div class="card-title">正式赛【' + compNow.name + '】</div>' +
            '<div class="card-desc">全部过线学生参加 | 赛制: ' + (window.CONTEST_FORMATS && window.CONTEST_FORMATS[compNow.format] ?
              window.CONTEST_FORMATS[compNow.format].description || compNow.format : '') +
              (compNow.registrationFee ? ' | 报名费: ¥' + compNow.registrationFee : '') +
            '</div></div>';
        }

        /* 训练行动 */
        html += '<div class="action-card training" onclick="RealRender.showTrainingUI()">' +
          '<div class="card-title">📝 训练</div>' +
          '<div class="card-desc">安排学生进行专项训练，提高实力（免费）</div></div>';

        html += '<div class="action-card heavy-training" onclick="RealRender.showHeavyTrainingUI()">' +
          '<div class="card-title">💪 高强度训练</div>' +
          '<div class="card-desc">付费训练，效率更高（¥500/学生）</div></div>';

        html += '<div class="action-card camp" onclick="RealRender.showCampUI()">' +
          '<div class="card-title">🏕️ 集训</div>' +
          '<div class="card-desc">消耗大量体力但全面提升知识点（¥1,000/人）</div></div>';

        html += '<div class="action-card outing" onclick="RealRender.showOutingUI()">' +
          '<div class="card-title">🎒 研学</div>' +
          '<div class="card-desc">外出研学，集中提升训练效率</div></div>';

        html += '<div class="action-card academic" onclick="RealRender._confirmAndDo(\'doAcademic\', \'修习文化课\')">' +
          '<div class="card-title">📚 修习文化课</div>' +
          '<div class="card-desc">提升文化课成绩，但减少训练时间</div></div>';

        html += '<div class="action-card exercise" onclick="RealRender.showExerciseUI()">' +
          '<div class="card-title">🏃 运动</div>' +
          '<div class="card-desc">提升体力，注意天气影响</div></div>';

        html += '<div class="action-card rest" onclick="RealRender._confirmAndDo(\'doRest\', \'休息\')">' +
          '<div class="card-title">😴 休息</div>' +
          '<div class="card-desc">恢复体力，降低压力</div></div>';

        html += '<div class="action-card entertainment" onclick="RealRender._confirmAndDo(\'doEntertain\', \'娱乐\')">' +
          '<div class="card-title">🎮 娱乐</div>' +
          '<div class="card-desc">大幅降低压力，微量减少知识</div></div>';

        /* 模拟赛 */
        html += '<div class="action-card mock" onclick="RealRender.showMockContestUI()">' +
          '<div class="card-title">📋 模拟赛</div>' +
          '<div class="card-desc">进行内部模拟比赛，检验成果</div></div>';
      } else {
        html += '<div class="action-taken-notice" style="margin:4px 0 8px;padding:8px;background:#fffbeb;border:1px solid #f6e05e;border-radius:6px;color:#975a16;font-size:13px;">本周已执行消耗行动，请进入下一周 ⏩</div>';
      }

        /* ====== 管理类行动（不占用行动机会，随时可用） ====== */
        html += '<div style="font-size:12px;color:#718096;margin:12px 0 4px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">管理类行动（不占用本周行动）</div>';

        html += '<div class="action-card recruit" onclick="RealRender._confirmAndDo(\'doRecruit\', \'对点招生（¥5,000）\', true)">' +
          '<div class="card-title">👥 对点招生</div>' +
          '<div class="card-desc">消耗声誉和经费招募新学生（¥5,000）</div></div>';

        html += '<div class="action-card treat" onclick="RealRender._confirmAndDo(\'doTreat\', \'请学生吃饭（¥800）\', true)">' +
          '<div class="card-title">🍽️ 请学生吃饭</div>' +
          '<div class="card-desc">降低压力，恢复体力（¥800）</div></div>';

        /* ====== 系统类行动 ====== */
        html += '<div style="font-size:12px;color:#718096;margin:12px 0 4px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">系统类行动</div>';

        /* 推进周 */
        html += '<div class="action-card advance-week" onclick="RealRender.advanceWeek()">' +
          '<div class="card-title" style="font-size:14px">⏩ 进入下一周</div>' +
          '<div class="card-desc" style="color:#38a169">推进到下一周</div></div>';

        /* 存档操作 */
        html += '<div class="action-card save" onclick="RealRender.showSaveUI()">' +
          '<div class="card-title">💾 保存游戏</div>' +
          '<div class="card-desc">保存当前进度</div></div>';

        html += '<div class="action-card load" onclick="RealRender.showLoadUI()">' +
          '<div class="card-title">📂 读取存档</div>' +
          '<div class="card-desc">读取已保存的进度</div></div>';

      el.innerHTML = html;

      /* 不再使用 body.comp-week 类控制显示，由 JS 逻辑自行管理行动栏内容 */
      document.body.classList.remove('comp-week');
    },

    /* ========================================================================
     * 第 5 节：比赛日程渲染
     * ======================================================================== */

    _renderContestSchedule: function (state) {
      var el = document.getElementById('contest-schedule');
      if (!el) return;

      var schedule = window.REAL_CONTEST_SCHEDULE || [];
      var html = '';
      for (var i = 0; i < schedule.length; i++) {
        var c = schedule[i];

        var isPast    = c.week < state.week;
        var isCurrent = c.week === state.week;
        var statusIcon  = isPast ? '✓' : (isCurrent ? '▶' : '○');
        var statusClass = isPast ? 'completed' : (isCurrent ? 'current' : '');

        var formatDesc = '';
        if (window.CONTEST_FORMATS && window.CONTEST_FORMATS[c.format]) {
          formatDesc = window.CONTEST_FORMATS[c.format].description || c.format;
        }

        var qualCount = 0;
        if (state.qualification && state.qualification[c.id]) {
          if (typeof state.qualification[c.id].size === 'number') qualCount = state.qualification[c.id].size;
          else if (typeof state.qualification[c.id].length === 'number') qualCount = state.qualification[c.id].length;
        }

        html += '<div class="contest-item ' + statusClass + '">' +
          '<span class="contest-icon">' + statusIcon + '</span>' +
          '<span class="contest-name">' + c.name + '</span>' +
          '<span class="contest-week">' + window.RealCalendar.formatWeek(c.week) + '</span>' +
          '<span class="contest-format">' + formatDesc + '</span>' +
          (c.registrationFee ? '<span class="contest-fee">¥' + c.registrationFee + '</span>' : '') +
          '<span class="contest-qual">' + qualCount + '人过线</span>' +
        '</div>';
      }

      el.innerHTML = html;
    },

    /* ========================================================================
     * 第 6 节：预算面板渲染
     * ======================================================================== */

    _renderBudget: function (state) {
      var el = document.getElementById('budget-panel');
      if (!el) return;

      var totalIncome   = 0;
      var totalExpenses = 0;
      if (typeof window.BudgetManager.getTotalIncome === 'function') totalIncome = window.BudgetManager.getTotalIncome();
      if (typeof window.BudgetManager.getTotalExpenses === 'function') totalExpenses = window.BudgetManager.getTotalExpenses();

      var maintenance = 0;
      if (state.facilities && typeof state.facilities.getMaintenanceCost === 'function') {
        maintenance = state.facilities.getMaintenanceCost();
      }

      el.innerHTML =
        '<div class="budget-amount">' + window.BudgetManager.formatFunds() + '</div>' +
        '<div class="budget-detail">收入: ¥' + totalIncome.toLocaleString() +
          ' / 支出: ¥' + totalExpenses.toLocaleString() + '</div>' +
        '<div class="budget-weekly">周维护: ¥' + maintenance.toLocaleString() + '</div>';
    },

    /* ========================================================================
     * 第 7 节：设施面板渲染
     * ======================================================================== */

    _renderFacilities: function (state) {
      var el = document.getElementById('facilities-panel');
      if (!el) return;
      var f = state.facilities;
      if (!f) return;

      // 计算维护费（修复原来 undefined 的问题）
      var maintenance = (typeof f.getMaintenanceCost === 'function')
        ? f.getMaintenanceCost() : 500;

      el.innerHTML =
        '<div class="small" style="line-height:1.8">' +
          '计算机 Lv.<span id="fac-computer-display">' + (f.computer || 1) + '</span>' +
          ' (' + (f.getMaxLevel('computer') || 5) + ') | ' +
          '资料库 Lv.<span id="fac-library-display">' + (f.library || 1) + '</span>' +
          ' (' + (f.getMaxLevel('library') || 5) + ') | ' +
          '宿舍 Lv.<span id="fac-dorm-display">' + (f.dorm || 1) + '</span>' +
          ' (' + (f.getMaxLevel('dorm') || 3) + ')<br>' +
          '空调 Lv.<span id="fac-ac-display">' + (f.ac || 1) + '</span>' +
          ' (' + (f.getMaxLevel('ac') || 3) + ') | ' +
          '食堂 Lv.<span id="fac-canteen-display">' + (f.canteen || 1) + '</span>' +
          ' (' + (f.getMaxLevel('canteen') || 3) + ') | ' +
          '维护费 ¥<span id="fac-maint-display">' + maintenance + '</span>' +
        '</div>' +
        '<button class="btn upgrade" style="margin-top:8px;width:100%;background:#38a169;color:#fff;padding:8px;font-size:13px;border-radius:6px;border:none;cursor:pointer" onclick="RealRender.showUpgradeUI()">升级设施</button>';
    },

    /* ========================================================================
     * 第 8 节：事件日志渲染
     * ======================================================================== */

    _renderEventLog: function (state) {
      var el = document.getElementById('event-log');
      if (!el) return;

      var recent = [];
      if (state.recentEvents && Array.isArray(state.recentEvents)) {
        recent = state.recentEvents.slice(-10).reverse();
      }

      if (recent.length === 0) {
        el.innerHTML = '<div class="muted" style="padding:8px">暂无事件</div>';
        return;
      }

      var html = '';
      for (var i = 0; i < recent.length; i++) {
        var evt = recent[i];
        html += '<div class="event-item event-' + (evt.type || 'info') + '">[第' +
          evt.week + '周] ' + evt.message + '</div>';
      }
      el.innerHTML = html;
    },

    /* ========================================================================
     * 第 9 节：游戏结束渲染
     * ======================================================================== */

    _renderGameOver: function (state) {
      // isFinalContest 已在 holdContest 中跳转到 real-end.html
      // 其他结束原因也跳转到独立结算页
      if (state.gameOverReason === '第二个IOI已结束，游戏结算') return;
      // 保存结算数据并跳转
      if (window.RealGame && window.RealGame._saveEndingData) {
        window.RealGame._saveEndingData();
        window.location.href = 'real-end.html';
      }
    },

    /* ========================================================================
     * 第 9b 节：结算页面（类似简化模式 end.html）
     * ======================================================================== */

    showSettlement: function () {
      var state = window.RealGame.state;
      if (!state) return;

      var el = document.getElementById('game-over-overlay');
      if (!el) return;
      el.style.display = 'flex';
      el.className = 'overlay';

      var medals = state.totalMedals || { gold: 0, silver: 0, bronze: 0 };
      var students = state.students || [];
      var competitions = state.careerCompetitions || [];
      var difficulty = state.difficulty || 2;
      var diffLabels = { 1: '简单', 2: '普通', 3: '困难' };
      var diffColors = { 1: '#4caf50', 2: '#2196f3', 3: '#f44336' };

      // 计算活跃学生最终属性
      var activeStudents = [];
      for (var si = 0; si < students.length; si++) {
        if (students[si].active !== false) activeStudents.push(students[si]);
      }

      // 统计每个学生在各比赛中的最佳成绩
      var studentBestScores = {};
      var studentMedalCounts = {};
      var contestHistory = {};
      for (var ci = 0; ci < competitions.length; ci++) {
        var comp = competitions[ci];
        var compName = comp.name || '';
        if (!contestHistory[compName]) contestHistory[compName] = {};
        if (comp.results) {
          for (var ri = 0; ri < comp.results.length; ri++) {
            var r = comp.results[ri];
            var sName = r.student ? r.student.name : '';
            if (sName) {
              if (!studentBestScores[sName]) studentBestScores[sName] = {};
              if (!studentMedalCounts[sName]) studentMedalCounts[sName] = { gold: 0, silver: 0, bronze: 0 };
              var prev = studentBestScores[sName][compName];
              var score = r.score || r.finalScore || 0;
              if (!prev || score > prev) {
                studentBestScores[sName][compName] = score;
              }
              if (r.medal) {
                studentMedalCounts[sName][r.medal] = (studentMedalCounts[sName][r.medal] || 0) + 1;
              }
              contestHistory[compName][sName] = {
                score: score,
                passed: r.passed,
                medal: r.medal
              };
            }
          }
        }
      }

      // 构建结算HTML
      var html = '<div class="game-over-content" style="max-height:85vh;overflow-y:auto;padding:16px;">';
      html += '<h2 style="text-align:center;color:#1565c0;margin-bottom:4px;">🏆 真实模式 · 赛季结算</h2>';
      html += '<p style="text-align:center;color:#666;font-size:13px;margin:0 0 12px">' + (state.gameOverReason || '') + '</p>';

      // 基本信息
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">';
      html += '<div class="small" style="background:#f5f7fa;padding:8px;border-radius:6px"><b>难度</b>: ' + (diffLabels[difficulty] || '普通') + '</div>';
      html += '<div class="small" style="background:#f5f7fa;padding:8px;border-radius:6px"><b>省份</b>: ' + (state.provinceName || '') + ' (' + (state.provinceType || '') + ')</div>';
      html += '<div class="small" style="background:#f5f7fa;padding:8px;border-radius:6px"><b>总周数</b>: ' + state.week + ' 周</div>';
      html += '<div class="small" style="background:#f5f7fa;padding:8px;border-radius:6px"><b>最终声誉</b>: ' + state.reputation + '</div>';
      html += '<div class="small" style="background:#f5f7fa;padding:8px;border-radius:6px"><b>初始/退赛</b>: ' + state.initial_students + ' / ' + state.quit_students + '</div>';
      html += '<div class="small" style="background:#f5f7fa;padding:8px;border-radius:6px"><b>总奖牌</b>: 🥇' + (medals.gold || 0) + ' 🥈' + (medals.silver || 0) + ' 🥉' + (medals.bronze || 0) + '</div>';
      html += '</div>';

      // 比赛时间线
      html += '<h3 style="font-size:15px;border-bottom:1px solid #ddd;padding-bottom:6px;margin:12px 0 8px">📅 比赛时间线</h3>';
      if (competitions.length === 0) {
        html += '<div class="muted">无比赛记录</div>';
      } else {
        html += '<div style="overflow-x:auto;margin-bottom:12px"><table style="width:100%;border-collapse:collapse;font-size:12px">';
        html += '<thead><tr style="background:#f0f4f8"><th style="padding:4px 6px">比赛</th><th style="padding:4px 6px">时间</th><th style="padding:4px 6px">结果</th></tr></thead><tbody>';
        for (var hi = 0; hi < competitions.length; hi++) {
          var hc = competitions[hi];
          var hPass = 0, hGold = 0, hSilver = 0, hBronze = 0;
          if (hc.results) {
            for (var hr = 0; hr < hc.results.length; hr++) {
              if (hc.results[hr].passed) hPass++;
              if (hc.results[hr].medal === 'gold') hGold++;
              else if (hc.results[hr].medal === 'silver') hSilver++;
              else if (hc.results[hr].medal === 'bronze') hBronze++;
            }
          }
          var medalStr = '';
          if (hGold) medalStr += '🥇×' + hGold;
          if (hSilver) medalStr += ' 🥈×' + hSilver;
          if (hBronze) medalStr += ' 🥉×' + hBronze;
          html += '<tr style="border-bottom:1px solid #eee"><td style="padding:4px 6px">' + (hc.name || '') + '</td>';
          html += '<td style="padding:4px 6px">' + (hc.week ? RealCalendar.formatWeek(hc.week) : '') + '</td>';
          html += '<td style="padding:4px 6px">' + hPass + '/' + (hc.results ? hc.results.length : 0) + ' 过线' + (medalStr ? ' | ' + medalStr : '') + '</td></tr>';
        }
        html += '</tbody></table></div>';
      }

      // 学生最终数据
      html += '<h3 style="font-size:15px;border-bottom:1px solid #ddd;padding-bottom:6px;margin:12px 0 8px">👨‍🎓 学生最终数据</h3>';
      if (activeStudents.length === 0) {
        html += '<div class="muted">无活跃学生</div>';
      } else {
        html += '<div style="overflow-x:auto;margin-bottom:12px"><table style="width:100%;border-collapse:collapse;font-size:11px">';
        html += '<thead><tr style="background:#f0f4f8"><th style="padding:3px 5px">姓名</th><th style="padding:3px 5px">思维</th><th style="padding:3px 5px">代码</th><th style="padding:3px 5px">心理</th><th style="padding:3px 5px">DS</th><th style="padding:3px 5px">图</th><th style="padding:3px 5px">字</th><th style="padding:3px 5px">数</th><th style="padding:3px 5px">DP</th><th style="padding:3px 5px">奖牌</th></tr></thead><tbody>';
        for (var ai = 0; ai < activeStudents.length; ai++) {
          var ast = activeStudents[ai];
          var mc = studentMedalCounts[ast.name] || { gold: 0, silver: 0, bronze: 0 };
          var mStr = '';
          if (mc.gold) mStr += '🥇' + mc.gold;
          if (mc.silver) mStr += '🥈' + mc.silver;
          if (mc.bronze) mStr += '🥉' + mc.bronze;
          html += '<tr style="border-bottom:1px solid #eee"><td style="padding:3px 5px;font-weight:600">' + ast.name + '</td>';
          html += '<td style="padding:3px 5px">' + Math.floor(ast.thinking) + '</td>';
          html += '<td style="padding:3px 5px">' + Math.floor(ast.coding) + '</td>';
          html += '<td style="padding:3px 5px">' + Math.floor(ast.mental) + '</td>';
          html += '<td style="padding:3px 5px">' + Math.floor(ast.knowledge_ds) + '</td>';
          html += '<td style="padding:3px 5px">' + Math.floor(ast.knowledge_graph) + '</td>';
          html += '<td style="padding:3px 5px">' + Math.floor(ast.knowledge_string) + '</td>';
          html += '<td style="padding:3px 5px">' + Math.floor(ast.knowledge_math) + '</td>';
          html += '<td style="padding:3px 5px">' + Math.floor(ast.knowledge_dp) + '</td>';
          html += '<td style="padding:3px 5px">' + (mStr || '-') + '</td></tr>';
        }
        html += '</tbody></table></div>';
      }

      // IOI成绩（如果有）
      var ioiComps = [];
      for (var ii = 0; ii < competitions.length; ii++) {
        if (competitions[ii].name && competitions[ii].name.indexOf('IOI') !== -1) {
          ioiComps.push(competitions[ii]);
        }
      }
      if (ioiComps.length > 0) {
        html += '<h3 style="font-size:15px;border-bottom:1px solid #ddd;padding-bottom:6px;margin:12px 0 8px">🌍 IOI 成绩</h3>';
        html += '<div style="overflow-x:auto;margin-bottom:12px"><table style="width:100%;border-collapse:collapse;font-size:12px">';
        html += '<thead><tr style="background:#f0f4f8"><th style="padding:4px 6px">链</th><th style="padding:4px 6px">学生</th><th style="padding:4px 6px">分数</th></tr></thead><tbody>';
        for (var ii2 = 0; ii2 < ioiComps.length; ii2++) {
          var ic = ioiComps[ii2];
          var isS2 = (ic.season === 2 || (ic.id && ic.id.indexOf('-S2') !== -1));
          if (ic.results) {
            for (ir = 0; ir < ic.results.length; ir++) {
              var ir2 = ic.results[ir];
              html += '<tr style="border-bottom:1px solid #eee"><td style="padding:4px 6px">' + (isS2 ? '链2' : '链1') + '</td>';
              html += '<td style="padding:4px 6px">' + ir2.student.name + '</td>';
              html += '<td style="padding:4px 6px;font-weight:600">' + (ir2.score || 0) + '</td></tr>';
            }
          }
        }
        html += '</tbody></table></div>';
      }

      // 赛事概览（按晋级链分组，而非按周数）
      var s1Comps = competitions.filter(function(c) { return !c.season || c.season !== 2; });
      var s2Comps = competitions.filter(function(c) { return c.season === 2; });
      html += '<h3 style="font-size:15px;border-bottom:1px solid #ddd;padding-bottom:6px;margin:12px 0 8px">📊 赛事概览</h3>';
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">';
      // 赛季1
      var s1Medals = { gold: 0, silver: 0, bronze: 0 };
      for (var s1i = 0; s1i < s1Comps.length; s1i++) {
        if (s1Comps[s1i].results) {
          for (var s1r = 0; s1r < s1Comps[s1i].results.length; s1r++) {
            var s1m = s1Comps[s1i].results[s1r].medal;
            if (s1m === 'gold') s1Medals.gold++;
            else if (s1m === 'silver') s1Medals.silver++;
            else if (s1m === 'bronze') s1Medals.bronze++;
          }
        }
      }
      html += '<div style="background:#e8f5e9;padding:10px;border-radius:8px;border-left:4px solid #4caf50">';
      html += '<div style="font-weight:600;margin-bottom:4px;color:#2e7d32">链1（高一起）</div>';
      html += '<div style="font-size:12px;color:#555">参赛 ' + s1Comps.length + ' 场 | 🥇' + s1Medals.gold + ' 🥈' + s1Medals.silver + ' 🥉' + s1Medals.bronze + '</div></div>';
      // 赛季2
      var s2Medals = { gold: 0, silver: 0, bronze: 0 };
      for (var s2i = 0; s2i < s2Comps.length; s2i++) {
        if (s2Comps[s2i].results) {
          for (var s2r = 0; s2r < s2Comps[s2i].results.length; s2r++) {
            var s2m = s2Comps[s2i].results[s2r].medal;
            if (s2m === 'gold') s2Medals.gold++;
            else if (s2m === 'silver') s2Medals.silver++;
            else if (s2m === 'bronze') s2Medals.bronze++;
          }
        }
      }
      html += '<div style="background:#e3f2fd;padding:10px;border-radius:8px;border-left:4px solid #2196f3">';
      html += '<div style="font-weight:600;margin-bottom:4px;color:#1565c0">链2（高二起）</div>';
      html += '<div style="font-size:12px;color:#555">参赛 ' + s2Comps.length + ' 场 | 🥇' + s2Medals.gold + ' 🥈' + s2Medals.silver + ' 🥉' + s2Medals.bronze + '</div></div>';
      html += '</div>';

      // 操作按钮
      html += '<div style="margin-top:16px;text-align:center">';
      html += '<button class="btn" onclick="window.location.href=\'real-start.html\'" style="background:#1565c0;color:#fff;padding:10px 24px;font-size:14px;border:none;border-radius:6px;cursor:pointer;margin:0 8px">返回主菜单</button>';
      html += '<button class="btn" onclick="document.getElementById(\'game-over-overlay\').style.display=\'none\'" style="background:#666;color:#fff;padding:10px 24px;font-size:14px;border:none;border-radius:6px;cursor:pointer;margin:0 8px">关闭</button>';
      html += '</div>';
      html += '</div>';

      el.innerHTML = html;
    },

    /* ========================================================================
     * 第 10 节：模态框系统（与简化模式一致的 #modal-root）
     * ======================================================================== */

    showModal: function (html) {
      var root = document.getElementById('modal-root');
      if (!root) return;
      root.innerHTML = '<div class="modal"><div class="dialog">' + html + '</div></div>';

      var dialog = root.querySelector('.dialog');
      if (!dialog) return;
      var actions = dialog.querySelector('.modal-actions');
      if (actions) {
        var panel = document.createElement('div');
        panel.className = 'modal-action-panel';
        while (actions.firstChild) { panel.appendChild(actions.firstChild); }
        actions.remove();
        dialog.appendChild(panel);
        var guard = document.createElement('div');
        guard.className = 'modal-action-guard';
        dialog.insertBefore(guard, dialog.firstChild);
      }

      var self = this;
      root._modalKeyHandler = function (e) {
        if (e.key === 'Escape') { self.closeModal(); }
        else if (e.key === 'Enter') {
          var panelBtn = dialog.querySelector('.modal-action-panel button:not(.btn-ghost):not(:disabled)');
          if (panelBtn) { try { panelBtn.click(); } catch (ex) {} }
          else {
            var other = dialog.querySelector('button:not(.btn-ghost):not(:disabled)');
            if (other) { try { other.click(); } catch (ex) {} }
          }
        }
      };
      window.addEventListener('keydown', root._modalKeyHandler);
    },

    closeModal: function () {
      var root = document.getElementById('modal-root');
      if (!root) return;
      if (root._modalKeyHandler) {
        try { window.removeEventListener('keydown', root._modalKeyHandler); } catch (ex) {}
        root._modalKeyHandler = null;
      }
      /* Clone all buttons to remove event listeners */
      var allBtns = root.querySelectorAll('button');
      for (var i = 0; i < allBtns.length; i++) {
        var clone = allBtns[i].cloneNode(true);
        if (allBtns[i].parentNode) allBtns[i].parentNode.replaceChild(clone, allBtns[i]);
      }
      root.innerHTML = '';
    },

    /* ========================================================================
     * 第 11 节：行动确认系统
     * ======================================================================== */

    /**
     * 显示确认对话框，确认后执行操作
     * @param {string} methodName - RealRender 上的方法名
     * @param {string} actionDesc - 行动描述（用于确认提示）
     */
    _confirmAndDo: function (methodName, actionDesc, isManagement) {
      var extraNote = isManagement
        ? '<span class="small muted">此操作为管理类行动，不消耗本周行动机会。</span>'
        : '<span class="small muted">此操作将消耗本周行动机会，无法撤销。</span>';
      this.showConfirm(
        '确认执行',
        '确定要执行「' + actionDesc + '」吗？<br><br>' + extraNote,
        function () { RealRender[methodName](); }
      );
    },

    /**
     * 显示确认对话框
     * @param {string} title - 对话框标题
     * @param {string} message - 确认消息
     * @param {Function} onConfirm - 确认后执行的回调
     */
    showConfirm: function (title, message, onConfirm) {
      var overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';

      overlay.innerHTML =
        '<div class="confirm-box">' +
          '<h3>' + title + '</h3>' +
          '<div class="confirm-message">' + message + '</div>' +
          '<div class="confirm-actions">' +
            '<button class="btn btn-cancel" onclick="this.closest(\'.confirm-overlay\').remove()">取消</button>' +
            '<button class="btn" onclick="this.closest(\'.confirm-overlay\').remove();(' +
              (typeof onConfirm === 'function' ? 'RealRender._confirmCallback()' : '') +
            ')">确认</button>' +
          '</div>' +
        '</div>';

      document.body.appendChild(overlay);

      /* 阻止事件冒泡 */
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) {
          overlay.remove();
        }
      });

      /* 绑定确认按钮 */
      window.RealRender._confirmCallback = function () {
        overlay.remove();
        if (typeof onConfirm === 'function') onConfirm();
      };
    },

    /* ========================================================================
     * 第 12 节：训练 UI
     * ======================================================================== */

    showTrainingUI: function () {
      var state = window.RealGame.state;
      var tasks = (state.weeklyTasks && state.weeklyTasks.length > 0) ?
        state.weeklyTasks : window.RealTraining.selectRandomTasks(6);

      var html = '<h3>📝 选择训练题目</h3>' +
        '<div class="small muted" style="margin-bottom:10px">从下方6道题目中选择一道进行训练。</div>';

      /* 筛选栏 */
      html += '<div class="filter-bar">';
      html += '<select id="filter-knowledge"><option value="">全部知识点</option>';
      var kp = window.KNOWLEDGE_POINTS || [];
      for (var i = 0; i < kp.length; i++) {
        html += '<option value="' + kp[i] + '">' + kp[i] + '</option>';
      }
      html += '</select>';
      html += '<select id="filter-diff"><option value="">全部难度</option>';
      var diffRanges = [
        { min: 0, max: 50, label: '入门-普及-' },
        { min: 51, max: 100, label: '普及-提高' },
        { min: 101, max: 150, label: '提高-省选' },
        { min: 151, max: 999, label: 'NOI+' }
      ];
      for (var d = 0; d < diffRanges.length; d++) {
        html += '<option value="' + diffRanges[d].min + '-' + diffRanges[d].max + '">' +
          diffRanges[d].label + '</option>';
      }
      html += '</select>';
      html += '<button class="btn btn-ghost" onclick="RealRender._refreshTasks()">筛选</button>';
      html += '</div>';

      /* 任务网格 */
      html += '<div class="task-grid" id="task-grid">';
      html += this._renderTaskCards(tasks);
      html += '</div>';

      /* 强度选择器 */
      html += '<label class="block" style="margin-top:14px">训练强度</label>';
      html += '<div class="intensity-selector">';
      html += '<label>训练强度：</label>';
      html += '<button class="intensity-btn active" data-intensity="1" onclick="RealRender._setIntensity(1)">轻</button>';
      html += '<button class="intensity-btn" data-intensity="2" onclick="RealRender._setIntensity(2)">中</button>';
      html += '<button class="intensity-btn" data-intensity="3" onclick="RealRender._setIntensity(3)">重</button>';
      html += '</div>';
      html += '<div class="small muted" style="margin-top:6px;text-align:center;">强度影响压力和训练效果</div>';

      /* 学生选择 */
      html += '<div id="selected-students-info"></div>';

      /* 确认/取消 */
      html += '<div class="modal-actions" style="margin-top:16px">';
      html += '<button class="btn btn-ghost" onclick="RealRender.closeModal()">取消</button>';
      html += '<button class="btn" id="train-confirm">开始训练（1周）</button>';
      html += '</div>';

      this._currentTasks = tasks;
      this._selectedTask = null;
      this._selectedIntensity = 1;
      this.showModal(html);

      var self = this;
      setTimeout(function () { self._refreshStudentSelection(); }, 10);

      /* 绑定确认按钮 */
      var confirmBtn = document.getElementById('train-confirm');
      if (confirmBtn) {
        confirmBtn.onclick = function () {
          var taskBtn = document.querySelector('.task-card.selected');
          if (!taskBtn) {
            alert('请先选择一道训练题目');
            return;
          }
          var taskIdx = parseInt(taskBtn.dataset.idx);
          var currentTasks = self._currentTasks || tasks;
          var selectedTask = currentTasks[taskIdx];
          var intensity = self._selectedIntensity || 2;
          var actionName = self._heavyTrainingMode ? '高强度训练' : '做题训练';

          var students = self._getSelectedStudentObjects();
          self.closeModal();
          self._heavyTrainingMode = false;
          var result = window.RealGame.executeAction(actionName, students, {
            task: selectedTask,
            intensity: intensity
          });
          if (result && result.success !== false) { self.renderAll(); }
          else if (result) { alert(result.message || result.summary || '操作失败'); }
        };
      }
    },

    showHeavyTrainingUI: function () {
      this._heavyTrainingMode = true;
      this.showTrainingUI();
      var title = document.querySelector('.dialog h3');
      if (title) { title.textContent = '💪 高强度训练 (¥500/学生)'; }
    },

    _renderTaskCards: function (tasks) {
      var INTENSITY_MULT = { 1: 1.0, 2: 1.5, 3: 2.5 };
      var intensity = RealRender._selectedIntensity || 1;
      var intensityMult = INTENSITY_MULT[intensity] || 1.0;
      // 高强度训练额外 ×1.5
      if (RealRender._heavyTrainingMode) { intensityMult *= 1.5; }

      var html = '';
      for (var i = 0; i < tasks.length; i++) {
        var t = tasks[i];
        var diffInfo = window.getDifficultyLabel(t.difficulty);

        // --- 思维 / 编码预估 ---
        var diffBonus = Math.min(2.0, t.difficulty / 50.0);
        var abilityMult = RealRender._heavyTrainingMode ? 1.5 : 1.0;
        var thinkingEst = Math.floor(1.875 * intensity * diffBonus * abilityMult);
        var codingEst = Math.floor(1.5 * intensity * diffBonus * abilityMult);

        html += '<div class="task-card ' + diffInfo.cls +
          '" data-idx="' + i + '" onclick="RealRender._selectTask(' + i + ')">' +
          '<div class="card-title" style="font-weight:600;margin-bottom:4px">' + t.name + '</div>' +
          '<div class="card-desc small muted">难度: ' + diffInfo.label + '</div>' +
          '<div class="task-boosts">';
        for (var j = 0; j < t.boosts.length; j++) {
          var adjusted = Math.round(t.boosts[j].amount * intensityMult);
          html += '<span class="boost-tag">' + t.boosts[j].type + '+' + adjusted + '</span>';
        }
        html += '</div>' +
          '<div class="task-boosts" style="margin-top:4px">' +
          '<span class="boost-tag boost-tag-ability">思维+' + thinkingEst + '</span>' +
          '<span class="boost-tag boost-tag-ability">编码+' + codingEst + '</span>' +
          '</div>' +
          '</div>';
      }
      return html;
    },

    _refreshTasks: function () {
      var knowledgeEl = document.getElementById('filter-knowledge');
      var diffEl      = document.getElementById('filter-diff');
      var options = {};
      if (knowledgeEl && knowledgeEl.value) { options.knowledgeType = knowledgeEl.value; }
      if (diffEl && diffEl.value) {
        var parts = diffEl.value.split('-');
        options.difficultyRange = [parseInt(parts[0], 10), parseInt(parts[1], 10)];
      }
      var tasks = window.RealTraining.selectRandomTasks(6, options);
      this._currentTasks = tasks;
      this._selectedTask = null;
      var grid = document.getElementById('task-grid');
      if (grid) {
        grid.innerHTML = this._renderTaskCards(tasks);
      }
    },

    _selectTask: function (index) {
      this._selectedTask = this._currentTasks[index];
      var cards = document.querySelectorAll('.task-card');
      for (var i = 0; i < cards.length; i++) {
        if (parseInt(cards[i].dataset.idx) === index) {
          cards[i].classList.add('selected');
        } else {
          cards[i].classList.remove('selected');
        }
      }
    },

    _setIntensity: function (level) {
      this._selectedIntensity = level;
      var btns = document.querySelectorAll('.intensity-btn');
      for (var i = 0; i < btns.length; i++) {
        if (parseInt(btns[i].getAttribute('data-intensity'), 10) === level) {
          btns[i].classList.add('active');
        } else {
          btns[i].classList.remove('active');
        }
      }
      // 重新渲染卡片以更新预估值
      var grid = document.getElementById('task-grid');
      if (grid && this._currentTasks) {
        grid.innerHTML = this._renderTaskCards(this._currentTasks);
      }
    },

    _refreshStudentSelection: function () {
      var el = document.getElementById('selected-students-info');
      if (!el) return;
      var students = window.RealGame.state.students;
      var activeStudents = [];
      for (var i = 0; i < students.length; i++) {
        if (students[i].active !== false) activeStudents.push(students[i]);
      }
      var html = '<div class="student-select">';
      for (var j = 0; j < activeStudents.length; j++) {
        html += '<label class="student-check">' +
          '<input type="checkbox" checked data-student="' +
          activeStudents[j].name.replace(/"/g, '&quot;') + '"> ' +
          activeStudents[j].name + '</label>';
      }
      html += '</div>';
      el.innerHTML = html;
    },

    _getSelectedStudentObjects: function () {
      var checkboxes = document.querySelectorAll('.student-check input:checked');
      var result = [];
      for (var i = 0; i < checkboxes.length; i++) {
        var name = checkboxes[i].getAttribute('data-student');
        for (var j = 0; j < window.RealGame.state.students.length; j++) {
          if (window.RealGame.state.students[j].name === name) {
            result.push(window.RealGame.state.students[j]);
            break;
          }
        }
      }
      return result;
    },

    /* ========================================================================
     * 第 13 节：简单操作（带确认）
     * ======================================================================== */

    showCampUI: function () {
      var html = '<h3>🏕️ 集训 (¥1,000/人)</h3>' +
        '<p class="small muted" style="margin-top:6px">集训会消耗大量体力，但全面提升所有知识点。</p>' +
        '<div id="selected-students-info"></div>' +
        '<div class="modal-actions" style="margin-top:12px">' +
        '<button class="btn btn-ghost" onclick="RealRender.closeModal()">取消</button>' +
        '<button class="btn" id="camp-confirm">确认集训（1周）</button>' +
        '</div>';
      this.showModal(html);
      var self = this;
      setTimeout(function () { self._refreshStudentSelection(); }, 10);

      var confirmBtn = document.getElementById('camp-confirm');
      if (confirmBtn) {
        confirmBtn.onclick = function () {
          var students = self._getSelectedStudentObjects();
          self.closeModal();
          var result = window.RealGame.executeAction('集训', students, {});
          if (result && result.success !== false) { self.renderAll(); }
          else if (result) { alert(result.message || result.summary || '操作失败'); }
        };
      }
    },

    showOutingUI: function () {
      var self = this;

      // 获取省份列表
      var provinces = (typeof PROVINCES !== 'undefined') ? PROVINCES : null;
      var provGridHtml = '<div id="out-prov-grid" class="prov-grid"></div>';
      if (!provinces) {
        provGridHtml = '<div style="color:#e53e3e;font-size:13px">省份数据未加载</div>';
      }

      var html =
        '<h3>🎒 研学</h3>' +
        '<p class="small muted" style="margin-top:6px">外出研学，选择难度和目的地，集中提升训练效率。消耗体力和经费。</p>' +
        '<label class="block" style="margin-top:10px">班型（难度）</label>' +
        '<select id="out-diff" style="width:100%;padding:6px;border:1px solid #ddd;border-radius:4px;font-size:14px">' +
          '<option value="1">基础班</option>' +
          '<option value="2">提高班</option>' +
          '<option value="3">冲刺班</option>' +
        '</select>' +
        '<label class="block" style="margin-top:10px">目的地（省份）</label>' +
        provGridHtml +
        '<div id="out-travel-info" class="small muted" style="margin-top:4px"></div>' +
        '<label class="block" style="margin-top:10px">选择学生（点击卡片选择参加）</label>' +
        '<div id="out-student-grid" class="student-grid" style="max-height:200px;overflow:auto;border:1px solid #eee;padding:6px;margin-bottom:8px"></div>' +
        '<div class="talent-inspire-panel collapsible" style="margin-top:12px;margin-bottom:12px;padding:10px;border:1px solid #e2e8f0;border-radius:6px;background:#f7fafc">' +
          '<h4 class="collapsible-head" style="margin:0;cursor:pointer;user-select:none;display:flex;align-items:center;justify-content:space-between">' +
            '<span>✨ 天赋激发</span>' +
            '<span class="collapse-arrow" style="font-size:12px;transition:transform 0.2s">▼</span>' +
          '</h4>' +
          '<div class="collapsible-content" style="margin-top:8px">' +
            '<div class="small muted" style="margin-bottom:8px">每选择一个激发天赋消耗 ¥12,000，参加研学的学生有 30% 概率获得该天赋</div>' +
            '<div id="out-talent-grid" class="talent-grid" style="max-height:200px;overflow:auto"></div>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
          '<div>预计费用: <strong id="out-cost-preview">¥0</strong> <span id="out-talent-cost-text" style="font-size:12px;color:#666"></span></div>' +
          '<div style="font-size:12px;color:#666">费用与人数和声誉有关</div>' +
        '</div>' +
        '<div class="modal-actions" style="margin-top:8px">' +
          '<button class="btn btn-ghost" onclick="RealRender.closeModal()">取消</button>' +
          '<button class="btn" id="outing-confirm">前往研学</button>' +
        '</div>';

      this.showModal(html);

      // 延迟渲染省份、学生和天赋
      setTimeout(function () {
        // --- 省份按钮 ---
        var outGrid = document.getElementById('out-prov-grid');
        if (outGrid && provinces) {
          for (var k in provinces) {
            if (!provinces.hasOwnProperty(k)) continue;
            (function (key) {
              var p = provinces[key];
              var btn = document.createElement('button');
              btn.className = 'prov-btn';
              btn.textContent = p.name;
              btn.dataset.val = key;
              btn.onclick = function () {
                var allBtns = outGrid.querySelectorAll('.prov-btn');
                for (var bi = 0; bi < allBtns.length; bi++) { allBtns[bi].classList.remove('selected'); }
                btn.classList.add('selected');
                updateOutingCostPreview();
              };
              outGrid.appendChild(btn);
            })(k);
          }
          // 默认选中第一个
          if (outGrid.firstChild) outGrid.firstChild.classList.add('selected');
        }

        // --- 学生卡片 ---
        var outStudentGrid = document.getElementById('out-student-grid');
        if (outStudentGrid) {
          var students = window.RealGame.state.students;
          var activeStudents = [];
          for (var si = 0; si < students.length; si++) {
            if (students[si].active !== false) activeStudents.push(students[si]);
          }
          for (var ai = 0; ai < activeStudents.length; ai++) {
            (function (s) {
              var card = document.createElement('div');
              card.className = 'student-card';
              card.style.cssText = 'display:inline-block;padding:6px;margin:4px;border:1px solid #ddd;border-radius:6px;cursor:pointer;min-width:120px;text-align:left;font-size:13px;opacity:0.45';
              card.dataset.name = s.name;
              card.dataset.selected = '0';

              var getGrade = window.getLetterGradeAbility || function (v) { return '?'; };

              var talentsHtml = '';
              if (s.talents && typeof s.talents.size === 'number' && s.talents.size > 0) {
                var talentArr = [];
                s.talents.forEach(function (tName) { talentArr.push(tName); });
                talentsHtml = talentArr.map(function (tName) {
                  var tInfo = (window.TalentManager && window.TalentManager.getTalentInfo) ? window.TalentManager.getTalentInfo(tName) : { name: tName, description: '', color: '#2b6cb0' };
                  return '<span class="talent-tag" data-talent="' + tName + '" style="background-color: ' + tInfo.color + '20; color: ' + tInfo.color + '; border-color: ' + tInfo.color + '40;">' +
                    tName +
                    '<span class="talent-tooltip">' + (tInfo.description || '') + '</span>' +
                    '</span>';
                }).join('');
              }

              var dsVal = Math.floor(Number(s.knowledge_ds || 0));
              var grVal = Math.floor(Number(s.knowledge_graph || 0));
              var stVal = Math.floor(Number(s.knowledge_string || 0));
              var mtVal = Math.floor(Number(s.knowledge_math || 0));
              var dpVal = Math.floor(Number(s.knowledge_dp || 0));
              var thVal = Math.floor(Number(s.thinking || 0));
              var cdVal = Math.floor(Number(s.coding || 0));

              card.innerHTML =
                '<strong style="display:block">' + s.name + '</strong>' +
                '<div style="color:#666;margin-top:4px">' +
                  '<span style="font-size:12px;color:#718096;font-weight:600;">知识</span>' +
                  '<div class="knowledge-badges">' +
                    '<span class="kb" title="数据结构: ' + dsVal + '" data-grade="' + getGrade(dsVal) + '">DS ' + getGrade(dsVal) + '</span>' +
                    '<span class="kb" title="图论: ' + grVal + '" data-grade="' + getGrade(grVal) + '">图论' + getGrade(grVal) + '</span>' +
                    '<span class="kb" title="字符串: ' + stVal + '" data-grade="' + getGrade(stVal) + '">字符串' + getGrade(stVal) + '</span>' +
                    '<span class="kb" title="数学: ' + mtVal + '" data-grade="' + getGrade(mtVal) + '">数学' + getGrade(mtVal) + '</span>' +
                    '<span class="kb" title="动态规划: ' + dpVal + '" data-grade="' + getGrade(dpVal) + '">DP ' + getGrade(dpVal) + '</span>' +
                    '<span class="kb ability" title="思维: ' + thVal + '" data-grade="' + getGrade(thVal) + '">思维' + getGrade(thVal) + '</span>' +
                    '<span class="kb ability" title="代码: ' + cdVal + '" data-grade="' + getGrade(cdVal) + '">代码' + getGrade(cdVal) + '</span>' +
                  '</div>' +
                '</div>' +
                (talentsHtml ? '<div style="display:flex;align-items:center;gap:6px;margin-top:6px;"><span style="font-size:12px;color:#718096;font-weight:600;">天赋</span><div class="student-talents">' + talentsHtml + '</div></div>' : '');

              card.onclick = function () {
                if (card.dataset.selected === '1') { card.dataset.selected = '0'; card.style.opacity = '0.45'; }
                else { card.dataset.selected = '1'; card.style.opacity = '1.0'; }
                updateOutingCostPreview();
              };
              outStudentGrid.appendChild(card);
            })(activeStudents[ai]);
          }
        }

        // --- 天赋激发 ---
        var outTalentGrid = document.getElementById('out-talent-grid');
        if (outTalentGrid && window.TalentManager && typeof window.TalentManager.getRegistered === 'function') {
          var allTalents = window.TalentManager.getRegistered() || [];
          for (var ti = 0; ti < allTalents.length; ti++) {
            (function (talentName) {
              // 过滤内部天赋和负面天赋，只保留正面天赋供激发
              if (talentName.indexOf('__') === 0) return;
              var info = (window.TalentManager.getTalentInfo && window.TalentManager.getTalentInfo(talentName)) || { name: talentName, description: '', color: '#2b6cb0' };
              if (info.beneficial === false) return;

              var card = document.createElement('div');
              card.className = 'talent-card';
              card.dataset.talent = talentName;
              card.dataset.selected = '0';
              card.style.cssText = 'cursor:pointer;opacity:0.5;transition:opacity 0.2s';

              var top = document.createElement('div');
              var dot = document.createElement('span');
              dot.className = 'color-dot';
              dot.style.background = info.color || '#2b6cb0';
              var title = document.createElement('span');
              title.className = 'title';
              title.textContent = talentName;
              top.appendChild(dot);
              top.appendChild(title);

              var desc = document.createElement('div');
              desc.className = 'desc';
              desc.textContent = info.description || '';

              card.appendChild(top);
              card.appendChild(desc);

              card.onclick = function () {
                if (card.dataset.selected === '1') {
                  card.dataset.selected = '0';
                  card.style.opacity = '0.5';
                  card.classList.remove('selected');
                } else {
                  card.dataset.selected = '1';
                  card.style.opacity = '1.0';
                  card.classList.add('selected');
                }
                updateOutingCostPreview();
              };
              outTalentGrid.appendChild(card);
            })(allTalents[ti]);
          }
        }

        // --- 折叠面板 ---
        var talentInspirePanel = document.querySelector('.talent-inspire-panel');
        if (talentInspirePanel) {
          var head = talentInspirePanel.querySelector('.collapsible-head');
          var arrow = head ? head.querySelector('.collapse-arrow') : null;
          head.onclick = function () {
            talentInspirePanel.classList.toggle('collapsed');
            if (talentInspirePanel.classList.contains('collapsed')) {
              if (arrow) arrow.style.transform = 'rotate(0deg)';
            } else {
              if (arrow) arrow.style.transform = 'rotate(180deg)';
            }
          };
        }

        // --- 费用预览 ---
        function updateOutingCostPreview() {
          var selectedCount = 0;
          var studentCards = document.querySelectorAll('#out-student-grid .student-card');
          for (var ci = 0; ci < studentCards.length; ci++) {
            if (studentCards[ci].dataset.selected === '1') selectedCount++;
          }
          var diffEl = document.getElementById('out-diff');
          var d = diffEl ? parseInt(diffEl.value) : 1;
          var provBtn = document.querySelector('#out-prov-grid .prov-btn.selected');
          var p = provBtn ? parseInt(provBtn.dataset.val) : 0;

          var baseCost = 0;
          if (window.RealTraining && typeof window.RealTraining.computeOutingCost === 'function') {
            var rep = (window.RealGame && window.RealGame.state) ? (window.RealGame.state.reputation || 0) : 0;
            baseCost = window.RealTraining.computeOutingCost(d, p, selectedCount, rep);
          }

          var talentCount = 0;
          var talentCards = document.querySelectorAll('#out-talent-grid .talent-card');
          for (var tci = 0; tci < talentCards.length; tci++) {
            if (talentCards[tci].dataset.selected === '1') talentCount++;
          }
          var talentCost = talentCount * 12000;
          var totalCost = baseCost + talentCost;

          var previewEl = document.getElementById('out-cost-preview');
          if (previewEl) previewEl.textContent = '\u00a5' + totalCost;

          // 显示路程距离倍率信息
          var travelInfoEl = document.getElementById('out-travel-info');
          if (travelInfoEl && window.RealTraining && typeof window.RealTraining._getTravelDistanceMultiplier === 'function') {
            var travelMult = window.RealTraining._getTravelDistanceMultiplier(p);
            var travelDesc = '';
            if (travelMult <= 1.0) travelDesc = '近距离（距离倍率 1.0x）';
            else if (travelMult <= 1.2) travelDesc = '相邻区域（距离倍率 1.2x）';
            else if (travelMult <= 1.4) travelDesc = '较远距离（距离倍率 1.4x）';
            else if (travelMult <= 1.6) travelDesc = '跨越南北（距离倍率 1.6x）';
            else travelDesc = '边疆/高原（距离倍率 1.8x）';
            travelInfoEl.textContent = '路程距离：' + travelDesc;
          }

          var talentCostTextEl = document.getElementById('out-talent-cost-text');
          if (talentCostTextEl) {
            if (talentCost > 0) {
              talentCostTextEl.textContent = '(含天赋激发 \u00a5' + talentCost + ')';
            } else {
              talentCostTextEl.textContent = '';
            }
          }
        }

        // --- 难度选择变更 ---
        var diffSelect = document.getElementById('out-diff');
        if (diffSelect) diffSelect.onchange = updateOutingCostPreview;

        // 初始费用预览
        updateOutingCostPreview();
      }, 10);

      // --- 确认按钮 ---
      var confirmBtn = document.getElementById('outing-confirm');
      if (confirmBtn) {
        confirmBtn.onclick = function () {
          // 收集选项
          var diffEl = document.getElementById('out-diff');
          var d = diffEl ? parseInt(diffEl.value) : 1;

          var provBtn = document.querySelector('#out-prov-grid .prov-btn.selected');
          var p = provBtn ? parseInt(provBtn.dataset.val) : 0;

          // 收集选中的学生
          var selectedStudents = [];
          var studentCards = document.querySelectorAll('#out-student-grid .student-card');
          for (var ci = 0; ci < studentCards.length; ci++) {
            if (studentCards[ci].dataset.selected === '1') {
              var sName = studentCards[ci].dataset.name;
              for (var si = 0; si < window.RealGame.state.students.length; si++) {
                if (window.RealGame.state.students[si].name === sName) {
                  selectedStudents.push(window.RealGame.state.students[si]);
                  break;
                }
              }
            }
          }

          if (selectedStudents.length === 0) { alert('请至少选择一名学生参加研学！'); return; }

          // 收集选中的天赋
          var inspireTalents = [];
          var talentCards = document.querySelectorAll('#out-talent-grid .talent-card');
          for (var tci = 0; tci < talentCards.length; tci++) {
            if (talentCards[tci].dataset.selected === '1') {
              inspireTalents.push(talentCards[tci].dataset.talent);
            }
          }

          var options = {
            difficulty: d,
            provinceIdx: p,
            inspireTalents: inspireTalents
          };

          self.closeModal();
          var result = window.RealGame.executeAction('研学', selectedStudents, options);
          if (result && result.success !== false) { self.renderAll(); }
          else if (result) { alert(result.message || result.summary || '操作失败'); }
        };
      }
    },

    showExerciseUI: function () {
      var html = '<h3>🏃 运动</h3>' +
        '<p class="small muted" style="margin-top:6px">运动效果取决于学生当前体力。</p>' +
        '<div id="selected-students-info"></div>' +
        '<div class="modal-actions" style="margin-top:12px">' +
        '<button class="btn btn-ghost" onclick="RealRender.closeModal()">取消</button>' +
        '<button class="btn" id="exercise-confirm">确认运动（1周）</button>' +
        '</div>';
      this.showModal(html);
      var self = this;
      setTimeout(function () { self._refreshStudentSelection(); }, 10);

      var confirmBtn = document.getElementById('exercise-confirm');
      if (confirmBtn) {
        confirmBtn.onclick = function () {
          var students = self._getSelectedStudentObjects();
          self.closeModal();
          var result = window.RealGame.executeAction('运动', students, {});
          if (result && result.success !== false) { self.renderAll(); }
          else if (result) { alert(result.message || result.summary || '操作失败'); }
        };
      }
    },

    showEntertainmentUI: function () {
      var html = '<h3>🎮 娱乐</h3>' +
        '<p class="small muted" style="margin-top:6px">大幅降低压力，但会微量减少知识。</p>' +
        '<div id="selected-students-info"></div>' +
        '<div class="modal-actions" style="margin-top:12px">' +
        '<button class="btn btn-ghost" onclick="RealRender.closeModal()">取消</button>' +
        '<button class="btn" id="entertain-confirm">确认娱乐（1周）</button>' +
        '</div>';
      this.showModal(html);
      var self = this;
      setTimeout(function () { self._refreshStudentSelection(); }, 10);

      var confirmBtn = document.getElementById('entertain-confirm');
      if (confirmBtn) {
        confirmBtn.onclick = function () {
          var students = self._getSelectedStudentObjects();
          self.closeModal();
          var result = window.RealGame.executeAction('娱乐', students, {});
          if (result && result.success !== false) { self.renderAll(); }
          else if (result) { alert(result.message || result.summary || '操作失败'); }
        };
      }
    },

    doAcademic: function () {
      var students = [];
      for (var i = 0; i < window.RealGame.state.students.length; i++) {
        if (window.RealGame.state.students[i].active !== false) students.push(window.RealGame.state.students[i]);
      }
      var result = window.RealGame.executeAction('修习文化课', students, {});
      if (result && result.success !== false) { this.renderAll(); }
      else if (result) { alert(result.message || result.summary || '操作失败'); }
    },

    doRest: function () {
      var students = [];
      for (var i = 0; i < window.RealGame.state.students.length; i++) {
        if (window.RealGame.state.students[i].active !== false) students.push(window.RealGame.state.students[i]);
      }
      var result = window.RealGame.executeAction('休息', students, {});
      if (result && result.success !== false) { this.renderAll(); }
      else if (result) { alert(result.message || result.summary || '操作失败'); }
    },

    doRecruit: function () {
      if (!window.RealGame.state) return;
      var result = window.RealGame.recruitStudent();
      if (result && result.success !== false) { this.renderAll(); }
      else if (result && result.message) { alert(result.message); }
    },

    doTreat: function () {
      if (!window.RealGame.state) return;
      var result = window.RealGame.treatStudents();
      if (result && result.success !== false) { this.renderAll(); }
      else if (result && result.message) { alert(result.message); }
    },

    doEntertain: function () {
      var students = [];
      for (var i = 0; i < window.RealGame.state.students.length; i++) {
        if (window.RealGame.state.students[i].active !== false) students.push(window.RealGame.state.students[i]);
      }
      var result = window.RealGame.executeAction('娱乐', students, {});
      if (result && result.success !== false) { this.renderAll(); }
      else if (result && result.message) { alert(result.message); }
    },

    dismissStudent: function (name) {
      window.RealGame.dismissStudent(name);
      this.renderAll();
    },

    advanceWeek: function () {
      var result = window.RealGame.advanceWeek();
      if (result && result.success !== false) { this.renderAll(); }
      else if (result && result.message) { alert(result.message); }
    },

    /* ========================================================================
     * 第 14 节：比赛操作
     * ======================================================================== */

    showContestSelection: function (contestId) {
      var contestDef = null;
      var schedule = window.REAL_CONTEST_SCHEDULE || [];
      for (var i = 0; i < schedule.length; i++) {
        if (schedule[i].id === contestId) { contestDef = schedule[i]; break; }
      }
      if (!contestDef) return;

      var state = window.RealGame.state;
      var eligibleStudents = [];
      for (var s = 0; s < state.students.length; s++) {
        if (state.students[s].active !== false) eligibleStudents.push(state.students[s]);
      }

      /* 按前置条件过滤 */
      if (contestDef.qualificationFrom) {
        var qualSet = state.qualification && state.qualification[contestDef.qualificationFrom];
        if (qualSet) {
          var filtered = [];
          for (var e = 0; e < eligibleStudents.length; e++) {
            var hasQual = false;
            if (typeof qualSet.has === 'function') { hasQual = qualSet.has(eligibleStudents[e].name); }
            else if (Array.isArray(qualSet)) {
              for (var qi = 0; qi < qualSet.length; qi++) {
                if (qualSet[qi] === eligibleStudents[e].name) { hasQual = true; break; }
              }
            }
            if (hasQual) filtered.push(eligibleStudents[e]);
          }
          eligibleStudents = filtered;
        }
      }

      var formatDesc = '';
      if (window.CONTEST_FORMATS && window.CONTEST_FORMATS[contestDef.format]) {
        formatDesc = window.CONTEST_FORMATS[contestDef.format].description || contestDef.format;
      }

      if (contestDef.required) {
        var html = '<h3>' + contestDef.name + '</h3>' +
          '<p class="small muted" style="margin-top:6px">赛制: ' + formatDesc + '</p>' +
          '<p class="small muted" style="margin-top:4px">全员参加（' + eligibleStudents.length + '人）</p>' +
          (contestDef.registrationFee ? '<p class="small muted">报名费: ¥' + contestDef.registrationFee + '</p>' : '') +
          '<div class="modal-actions" style="margin-top:12px">' +
            '<button class="btn btn-ghost" onclick="RealRender.closeModal()">取消</button>' +
            '<button class="btn" onclick="RealRender._startContest(\'' + contestId + '\')">开始比赛</button>' +
          '</div>';
        this.showModal(html);
      } else {
        var html = '<h3>' + contestDef.name + '</h3>' +
          '<p class="small muted" style="margin-top:6px">赛制: ' + formatDesc + '</p>' +
          '<div id="selected-students-info"></div>' +
          '<div class="modal-actions" style="margin-top:12px">' +
            '<button class="btn btn-ghost" onclick="RealRender.closeModal()">取消</button>' +
            '<button class="btn" onclick="RealRender._startContest(\'' + contestId + '\')">开始比赛</button>' +
          '</div>';
        this.showModal(html);
        /* 渲染学生复选框 */
        var el = document.getElementById('selected-students-info');
        if (el) {
          var checkHtml = '<div class="student-select">';
          for (var ci = 0; ci < eligibleStudents.length; ci++) {
            checkHtml += '<label class="student-check">' +
              '<input type="checkbox" checked data-student="' +
              eligibleStudents[ci].name.replace(/"/g, '&quot;') + '"> ' +
              eligibleStudents[ci].name + '</label>';
          }
          checkHtml += '</div>';
          el.innerHTML = checkHtml;
        }
      }
    },

    _startContest: function (contestId) {
      var contestDef = null;
      var schedule = window.REAL_CONTEST_SCHEDULE || [];
      for (var i = 0; i < schedule.length; i++) {
        if (schedule[i].id === contestId) { contestDef = schedule[i]; break; }
      }
      if (!contestDef) return;

      var students;
      if (contestDef.required) {
        students = [];
        for (var s = 0; s < window.RealGame.state.students.length; s++) {
          if (window.RealGame.state.students[s].active !== false) students.push(window.RealGame.state.students[s]);
        }
      } else {
        students = this._getSelectedStudentObjects();
      }
      if (students.length === 0) { alert('没有参赛学生'); return; }

      this.closeModal();
      var simulator = window.RealGame.holdContest(contestDef, students);
      if (!simulator) { alert('无法启动比赛模拟器'); return; }
      this._simulator = simulator;
      this._showContestLive(simulator);
    },

    _showContestLive: function (simulator) {
      var config = simulator.config || {};
      var formatDesc = '';
      if (window.CONTEST_FORMATS && window.CONTEST_FORMATS[config.format]) {
        formatDesc = window.CONTEST_FORMATS[config.format].description || config.format;
      }
      var numProblems = (config.problems || []).length;
      var duration = config.duration || 180;

      var html = '<div class="contest-live-container" style="display:flex;gap:12px;align-items:flex-start;">' +
        /* 左侧：学生面板 */
        '<div style="flex:2;min-width:0;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
            '<div style="font-size:15px;font-weight:700;">' + (config.name || '比赛') + ' <span class="tag" style="font-size:11px;">' + formatDesc + '</span></div>' +
            '<div style="font-size:12px;color:#666;">总时长: ' + duration + ' 分钟</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">' +
            '<div style="flex:1;height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden;">' +
              '<div id="contest-progress-bar" style="width:0%;height:100%;background:#4299e1;border-radius:3px;transition:width 0.3s;"></div>' +
            '</div>' +
            '<span id="contest-timer" style="font-size:12px;color:#4a5568;white-space:nowrap;">0 / ' + duration + ' 分钟</span>' +
          '</div>' +
          '<div id="contest-students"></div>' +
          '<div class="contest-controls" style="margin-top:10px;display:flex;gap:8px;">' +
            '<button class="btn" onclick="RealRender._speedContest()">加速</button>' +
            '<button class="btn" onclick="RealRender._finishContest()">结束</button>' +
          '</div>' +
        '</div>' +
        /* 右侧：日志 */
        '<div style="flex:1;display:flex;flex-direction:column;min-width:200px;">' +
          '<div style="font-size:13px;font-weight:600;margin-bottom:6px;">比赛日志</div>' +
          '<div id="contest-log" style="flex:1;max-height:400px;overflow-y:auto;background:#f7fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px;font-size:12px;line-height:1.6;"></div>' +
        '</div>' +
      '</div>';

      this.showModal(html);
      this._renderContestStudents();
      this._renderContestLog();
      // 启动模拟器运行状态（running=true 使 runTick 正常执行）
      simulator.running = true;
      this._startContestTimer();
    },

    _renderContestStudents: function () {
      var container = document.getElementById('contest-students');
      if (!container) return;
      var html = '';
      var names = [];
      for (var name in this._simulator.studentStates) {
        if (this._simulator.studentStates.hasOwnProperty(name)) names.push(name);
      }
      for (var i = 0; i < names.length; i++) {
        var name = names[i];
        var st = this._simulator.studentStates[name];
        var numProbs = st.problems ? st.problems.length : 0;
        html += '<div class="contest-student-panel" id="panel-' + i + '" style="margin-bottom:8px;padding:8px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;">' +
            '<div style="font-weight:600;font-size:14px;">' + name + '</div>' +
            '<div id="score-' + i + '" style="font-weight:700;font-size:16px;color:#2b6cb0;">0</div>' +
          '</div>' +
          '<div id="current-' + i + '" style="font-size:11px;color:#718096;margin-top:2px;">当前: 未选题</div>' +
          /* 每题分数网格 */
          '<div class="problem-grid" id="problems-' + i + '" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">';
        for (var p = 0; p < numProbs; p++) {
          var maxS = st.problems[p].maxScore || 0;
          html += '<div class="problem-cell" id="prob-' + i + '-' + p + '" style="display:flex;flex-direction:column;align-items:center;padding:4px 8px;border:1px solid #e2e8f0;border-radius:4px;min-width:48px;background:#f9fafb;">' +
            '<div class="prob-label" style="font-size:10px;color:#718096;">T' + (p + 1) + '</div>' +
            '<div class="prob-score" style="font-size:13px;font-weight:600;">0</div>' +
            '<div class="prob-max" style="font-size:9px;color:#a0aec0;">/' + maxS + '</div>' +
          '</div>';
        }
        html += '</div></div>';
      }
      container.innerHTML = html;
    },

    _renderContestLog: function () {
      var container = document.getElementById('contest-log');
      if (!container) return;
      var log = this._simulator.getLog ? this._simulator.getLog() : [];
      var html = '';
      for (var i = 0; i < log.length; i++) {
        var logType = log[i].type || 'info';
        html += '<div class="log-entry log-' + logType + '">' + log[i].text + '</div>';
      }
      container.innerHTML = html;
      container.scrollTop = container.scrollHeight;
    },

    _startContestTimer: function () {
      var self = this;
      if (this._contestTimer) clearInterval(this._contestTimer);
      this._contestTimer = setInterval(function () {
        self._contestTimerTick();
      }, 1500);
    },

    _contestTimerTick: function () {
      if (!this._simulator) return;
      this._simulator.runTick();
      this._updateContestProgress();
      this._updateContestScores();
      this._renderContestLog();

      if (this._simulator.finished) {
        clearInterval(this._contestTimer);
        this._contestTimer = null;
      }
    },

    _updateContestProgress: function () {
      var timer = document.getElementById('contest-timer');
      var bar = document.getElementById('contest-progress-bar');
      if (!timer || !this._simulator) return;
      var tickInterval = this._simulator.tickInterval || 10;
      var elapsed = (this._simulator.tick || 0) * tickInterval;
      var total = this._simulator.maxTicks * tickInterval;
      var pct = Math.min(100, Math.floor(elapsed / total * 100));
      timer.innerText = elapsed + ' / ' + total + ' 分钟';
      if (bar) bar.style.width = pct + '%';
    },

    _updateContestScores: function () {
      var names = [];
      for (var name in this._simulator.studentStates) {
        if (this._simulator.studentStates.hasOwnProperty(name)) names.push(name);
      }
      for (var i = 0; i < names.length; i++) {
        var name = names[i];
        var st = this._simulator.studentStates[name];

        // 总分
        var scoreEl = document.getElementById('score-' + i);
        if (scoreEl) scoreEl.innerText = Math.floor(st.totalScore || 0);

        // 当前题目
        var curEl = document.getElementById('current-' + i);
        if (curEl) {
          if (st.currentProblem >= 0 && !st.finished) {
            var thinking = st.thinkingTime || 0;
            curEl.innerText = '当前: T' + (st.currentProblem + 1) + ' (思考 ' + thinking + ' 分钟)';
            curEl.style.color = '#2b6cb0';
          } else if (st.finished) {
            curEl.innerText = '已完成全部题目';
            curEl.style.color = '#38a169';
          } else {
            curEl.innerText = '当前: 未选题';
            curEl.style.color = '#718096';
          }
        }

        // 每题分数
        for (var p = 0; p < st.problems.length; p++) {
          var prob = st.problems[p];
          var cellEl = document.getElementById('prob-' + i + '-' + p);
          if (!cellEl) continue;
          var scoreDiv = cellEl.querySelector('.prob-score');
          if (scoreDiv) scoreDiv.innerText = Math.floor(prob.actualScore || 0);

          // 状态着色
          if (prob.solved) {
            cellEl.style.borderColor = '#48bb78';
            cellEl.style.background = '#f0fff4';
            if (scoreDiv) scoreDiv.style.color = '#22543d';
          } else if (prob.actualScore > 0) {
            cellEl.style.borderColor = '#ed8936';
            cellEl.style.background = '#fffaf0';
            if (scoreDiv) scoreDiv.style.color = '#c05621';
          } else {
            cellEl.style.borderColor = '#e2e8f0';
            cellEl.style.background = '#f9fafb';
            if (scoreDiv) scoreDiv.style.color = '#a0aec0';
          }
        }
      }
    },

    _speedContest: function () {
      if (!this._simulator) return;
      for (var i = 0; i < 3; i++) {
        if (!this._simulator.finished) {
          this._simulator.runTick();
        }
      }
      this._updateContestProgress();
      this._updateContestScores();
      this._renderContestLog();
    },

    _finishContest: function () {
      clearInterval(this._contestTimer);
      this._contestTimer = null;
      // 直接调用 simulator.finish() 触发 onFinish 回调
      if (this._simulator && !this._simulator.finished) {
        this._simulator.finish();
      }
    },

    /* 公开方法：比赛结果展示（由 real-game.js 的 onFinish 回调调用）
     * 显示：每题原始分、挂分详情、性格修正详情、最终分 */
    showContestResults: function (results, contestDef) {
      if (!results) return;

      var isMock = (contestDef && contestDef.id === 'mock');

      var html = '<h3>' + (isMock ? '📋' : '🏆') + ' ' + (contestDef.name || '比赛') + ' 结果</h3>';
      html += '<div style="margin-top:12px">';

      /* 过线信息 */
      if (!isMock && results.passLine !== undefined) {
        html += '<div class="small muted">分数线: ' + results.passLine + '/' + results.totalMax + '</div>';
      }

      /* 奖牌统计 */
      var goldCount = 0, silverCount = 0, bronzeCount = 0, passCount = 0;
      for (var i = 0; i < results.results.length; i++) {
        var r = results.results[i];
        if (r.passed) passCount++;
        if (r.medal === 'gold') goldCount++;
        else if (r.medal === 'silver') silverCount++;
        else if (r.medal === 'bronze') bronzeCount++;
      }

      if (!isMock && goldCount + silverCount + bronzeCount > 0) {
        html += '<div class="medal-display" style="margin:10px 0">';
        if (goldCount > 0) html += '<span style="margin-right:12px">🥇 金牌 x' + goldCount + '</span>';
        if (silverCount > 0) html += '<span style="margin-right:12px">🥈 银牌 x' + silverCount + '</span>';
        if (bronzeCount > 0) html += '<span>🥉 铜牌 x' + bronzeCount + '</span>';
        html += '</div>';
      }

      if (!isMock) {
        html += '<div class="small muted">' + passCount + '/' + results.results.length + ' 人过线</div>';
      }

      /* 确定题目列数 */
      var numProbs = 0;
      if (results.results.length > 0 && results.results[0].problems) {
        numProbs = results.results[0].problems.length;
      }

      /* ========== 结果表格 ========== */
      var thStyle = 'style="font-size:11px;padding:4px 6px;"';
      var tdStyle = 'style="padding:4px 6px;font-size:12px;"';

      html += '<div style="overflow-x:auto;margin-top:10px;"><table style="width:100%;border-collapse:collapse;font-size:13px">' +
        '<thead><tr style="background:#f5f5f5"><th ' + thStyle + '>学生</th>';
      for (var pi = 0; pi < numProbs; pi++) {
        html += '<th ' + thStyle + '>T' + (pi + 1) + '</th>';
      }
      html += '<th ' + thStyle + '>总分</th>';
      if (!isMock) {
        html += '<th ' + thStyle + '>结果</th>';
      }
      html += '</tr></thead><tbody>';

      for (var j = 0; j < results.results.length; j++) {
        var row = results.results[j];
        var passed = row.passed;
        var rowColor = (!isMock && !passed) ? 'color:#c53030;' : '';
        html += '<tr style="border-bottom:1px solid #eee;' + rowColor + '">' +
          '<td ' + tdStyle + ' style="font-weight:600;">' + row.student.name + '</td>';

        // 逐题分数：显示最终得分 + 挂分(红)/骗分(绿)小字注释
        if (row.problems) {
          for (var pj = 0; pj < row.problems.length; pj++) {
            var prob = row.problems[pj];
            var pMax = prob.maxScore || 100;
            var pActual = Math.floor(prob.actualScore || 0);      // 挂分后的原始分
            var pFinal = Math.floor(prob.finalScore || pActual);   // 性格修正后的最终分

            // 挂分：mistakePenalty > 0
            var hasMistake = prob.mistakePenalty && prob.mistakePenalty > 0;
            // 骗分：性格修正带来的正向加分
            var modifierBonus = pFinal - pActual;
            var hasBonus = modifierBonus > 0;

            // 主数字样式
            var cellContent = '';
            var cellStyle = 'text-align:center;vertical-align:middle;';

            if (pFinal >= pMax) {
              // AC：绿色加粗
              cellStyle += 'color:#22543d;font-weight:bold;';
            } else if (pFinal > 0) {
              cellStyle += 'color:#c05621;';
            } else {
              cellStyle += 'color:#a0aec0;';
            }

            // 主数字
            cellContent = '<div style="font-size:13px;">' + pFinal + '</div>';

            // 小字注释：挂分(红) / 骗分(绿)
            var annotations = [];
            if (hasMistake) {
              cellStyle += 'background:#fff8f0;';
              annotations.push('<span style="color:#d32f2f;">挂分: -' + prob.mistakePenalty + '</span>');
            }
            if (hasBonus) {
              if (!hasMistake) cellStyle += 'background:#f0fff4;';
              annotations.push('<span style="color:#38a169;">骗分: +' + modifierBonus + '</span>');
            }
            if (annotations.length > 0) {
              cellContent += '<div style="font-size:9px;margin-top:1px;line-height:1.4;">' + annotations.join(' ') + '</div>';
            }

            html += '<td ' + tdStyle + ' style="' + cellStyle + '">' + cellContent + '</td>';
          }
        }

        // 总分
        var finalScore = Math.floor(row.score || 0);
        html += '<td ' + tdStyle + ' style="font-weight:700;">' + finalScore + '</td>';

        if (!isMock) {
          html += '<td ' + tdStyle + '>' + (passed ? '✅ 通过' : '❌ 未通过') + '</td>';
        }
        html += '</tr>';
      }
      html += '</tbody></table></div>';

      html += '<div class="modal-actions" style="margin-top:12px">' +
        '<button class="btn" onclick="RealRender.closeModal(); RealRender.renderAll()">确定</button></div>';

      this.showModal(html);
    },

    /* ========================================================================
     * 第 15 节：模拟赛
     * ======================================================================== */

    showMockContestUI: function () {
      var html = '<h3>📋 举办模拟赛</h3>' +
        '<p class="small muted" style="margin-top:6px">模拟赛不会影响真实比赛资格，但可以训练能力。</p>';

      /* 平台选择 — 使用 ONLINE_CONTEST_TYPES */
      html += '<div style="margin-top:12px">';
      html += '<label class="block" style="font-weight:600;margin-bottom:6px;font-size:13px">选择平台</label>';
      html += '<div class="intensity-selector" style="display:flex;flex-wrap:wrap;gap:6px">';
      var contestTypes = (typeof ONLINE_CONTEST_TYPES !== 'undefined') ? ONLINE_CONTEST_TYPES : [];
      if (contestTypes.length === 0) {
        contestTypes = [
          { name: '洛谷月赛', numProblems: 4, difficulty: 240, displayName: '洛谷月赛' },
          { name: 'Atcoder-ABC', numProblems: 7, difficulty: 120, displayName: 'Atcoder ABC' },
          { name: 'Atcoder-ARC', numProblems: 4, difficulty: 230, displayName: 'Atcoder ARC' }
        ];
      }
      for (var pi = 0; pi < contestTypes.length; pi++) {
        var t = contestTypes[pi];
        var desc = (t.displayName || t.name) + ' (' + t.numProblems + '题, 难度' + t.difficulty + ')';
        html += '<button class="intensity-btn' + (pi === 0 ? ' active' : '') + '" data-idx="' + pi +
          '" onclick="RealRender._selectContestType(this)" title="' + desc + '">' + (t.displayName || t.name) + '</button>';
      }
      html += '</div>';
      html += '<div id="mock-platform-desc" class="small muted" style="margin-top:4px">' +
        (contestTypes[0].displayName || contestTypes[0].name) + ' (' + contestTypes[0].numProblems + '题)</div>';
      html += '</div>';

      /* 学生选择 */
      html += '<div id="selected-students-info" style="margin-top:10px"></div>';

      /* 确认/取消 */
      html += '<div class="modal-actions" style="margin-top:12px">' +
        '<button class="btn btn-ghost" onclick="RealRender.closeModal()">取消</button>' +
        '<button class="btn" onclick="RealRender._startMockContest()">开始模拟赛</button>' +
        '</div>';

      this._selectedContestType = contestTypes[0];
      this._contestTypes = contestTypes;
      this.showModal(html);

      var self = this;
      setTimeout(function () { self._refreshStudentSelection(); }, 10);
    },

    _selectContestType: function (btn) {
      var idx = parseInt(btn.getAttribute('data-idx'), 10);
      var contestTypes = this._contestTypes || [];
      if (idx < 0 || idx >= contestTypes.length) return;
      var contestType = contestTypes[idx];
      this._selectedContestType = contestType;

      /* 更新按钮高亮 */
      var btns = btn.parentNode.querySelectorAll('.intensity-btn');
      for (var j = 0; j < btns.length; j++) {
        if (parseInt(btns[j].getAttribute('data-idx'), 10) === idx) {
          btns[j].classList.add('active');
        } else {
          btns[j].classList.remove('active');
        }
      }

      /* 更新描述 */
      var descEl = document.getElementById('mock-platform-desc');
      if (descEl) {
        descEl.textContent = (contestType.displayName || contestType.name) +
          ' (' + contestType.numProblems + '题)';
      }
    },

    _startMockContest: function () {
      var contestType = this._selectedContestType ||
        { difficulty: 120, numProblems: 4, displayName: '模拟赛' };

      var students = this._getSelectedStudentObjects();
      if (!students || students.length === 0) {
        alert('请至少选择一名学生');
        return;
      }
      this.closeModal();
      var simulator = window.RealGame.holdMockContest(students, contestType);
      if (!simulator) { alert('无法启动模拟赛'); return; }
      this._simulator = simulator;
      this._showContestLive(simulator);
    },

    /* ========================================================================
     * 第 16 节：存档管理
     * ======================================================================== */

    showSaveUI: function () {
      var html = '<h3>💾 保存游戏</h3>' +
        '<div class="save-slots" id="save-slots"></div>' +
        '<div class="modal-actions" style="margin-top:12px">' +
        '<button class="btn btn-ghost" onclick="RealRender.closeModal()">取消</button>' +
        '</div>';
      this.showModal(html);

      var slotsEl = document.getElementById('save-slots');
      if (!slotsEl) return;

      /* 获取已有存档信息 */
      var saves = [];
      if (window.RealSaveManager && typeof window.RealSaveManager.listSlots === 'function') {
        saves = window.RealSaveManager.listSlots() || [];
      }

      var slotHtml = '';
      for (var si = 0; si < 5; si++) {
        var save = null;
        // listSlots 返回 {index, name, week, timestamp, dateStr, isAuto}，自动存档 index=-1
        for (var j = 0; j < saves.length; j++) {
          if (saves[j].index === si) { save = saves[j]; break; }
        }
        var hasSave = save && save.timestamp;
        slotHtml += '<div class="save-slot ' + (hasSave ? 'has-save' : '') +
          '" onclick="RealRender._saveToSlot(' + si + ')" data-slot="' + si + '">' +
          '存档位 ' + (si + 1) +
          (hasSave ? '<small>' + save.dateStr + ' | 第' + save.week + '周</small>' : '<small>空</small>') +
          '</div>';
      }
      slotsEl.innerHTML = slotHtml;
    },

    _saveToSlot: function (slotIndex) {
      var state = window.RealGame.state;
      if (!state) { alert('无游戏状态'); return; }
      var serialized = window.RealGame._serializeState();
      var ok = window.RealSaveManager.save(slotIndex, serialized);
      this.closeModal();
      if (ok) {
        alert('保存成功');
        this.renderAll();
      } else {
        alert('保存失败');
      }
    },

    showLoadUI: function () {
      var html = '<h3>📂 读取存档</h3>' +
        '<div class="save-slots" id="save-slots"></div>' +
        '<div class="modal-actions" style="margin-top:12px">' +
        '<button class="btn btn-ghost" onclick="RealRender.closeModal()">取消</button>' +
        '</div>';
      this.showModal(html);

      var slotsEl = document.getElementById('save-slots');
      if (!slotsEl) return;

      /* 获取已有存档信息 */
      var saves = [];
      if (window.RealSaveManager && typeof window.RealSaveManager.listSlots === 'function') {
        saves = window.RealSaveManager.listSlots() || [];
      }

      var slotHtml = '';
      for (var si = 0; si < 5; si++) {
        var save = null;
        for (var j = 0; j < saves.length; j++) {
          if (saves[j].index === si) { save = saves[j]; break; }
        }
        var hasSave = save && save.timestamp;
        slotHtml += '<div class="save-slot ' + (hasSave ? 'has-save' : '') +
          '" onclick="RealRender._loadFromSlot(' + si + ')" data-slot="' + si + '">' +
          '存档位 ' + (si + 1) +
          (hasSave ? '<small>' + save.dateStr + ' | 第' + save.week + '周</small>' : '<small>空</small>') +
          '</div>';
      }
      slotsEl.innerHTML = slotHtml;
    },

    _loadFromSlot: function (slotIndex) {
      var result = window.RealGame.loadGame(slotIndex);
      this.closeModal();
      if (result && result.success !== false) { this.renderAll(); }
      else if (result && result.message) { alert(result.message); }
    },

    /* ========================================================================
     * 第 17 节：设施升级
     * ======================================================================== */

    showUpgradeUI: function () {
      var state = window.RealGame.state;
      var f = state.facilities;
      if (!f) return;

      var html = '<h3>🔧 设施升级</h3>' +
        '<div class="upgrade-list">';

      var facilities = [
        { key: 'computer', name: '💻 电脑', desc: '提升思维/编码训练效率', level: f.computer || 1 },
        { key: 'ac', name: '❄️ 空调', desc: '提升舒适度，缓解极端天气', level: f.ac || 1 },
        { key: 'dorm', name: '🏠 宿舍', desc: '提升舒适度', level: f.dorm || 1 },
        { key: 'library', name: '📚 图书馆', desc: '提升知识训练效率', level: f.library || 1 },
        { key: 'canteen', name: '🍽️ 食堂', desc: '减少训练压力', level: f.canteen || 1 }
      ];

      for (var fi = 0; fi < facilities.length; fi++) {
        var fac = facilities[fi];
        var maxLevel = f.getMaxLevel(fac.key);
        var cost = f.getUpgradeCost(fac.key);
        var isMaxed = (fac.level >= maxLevel);
        var canAfford = (window.BudgetManager && window.BudgetManager.getFunds() >= cost);

        html += '<div class="upgrade-item">' +
          '<div><strong>' + fac.name + '</strong> Lv.' + fac.level + '/' + maxLevel +
            '<span class="small muted"> | ' + fac.desc + '</span></div>' +
          (isMaxed
            ? '<button class="btn upgrade" data-fac="' + fac.key + '" disabled>已满级</button>'
            : '<button class="btn upgrade" data-fac="' + fac.key + '"' +
              (canAfford ? '' : ' disabled') + '>升级 (¥' + cost.toLocaleString() + ')</button>') +
        '</div>';
      }

      html += '</div>' +
        '<div class="modal-actions" style="margin-top:12px">' +
        '<button class="btn btn-ghost" onclick="RealRender.closeModal()">取消</button>' +
        '</div>';

      this.showModal(html);

      /* 绑定升级按钮 */
      var btns = document.querySelectorAll('.upgrade[data-fac]');
      var self = this;
      for (var bi = 0; bi < btns.length; bi++) {
        btns[bi].onclick = function () {
          var facKey = this.getAttribute('data-fac');
          self.closeModal();
          var result = window.RealGame.upgradeFacility(facKey);
          if (result && result.success !== false) { self.renderAll(); }
          else if (result && result.message) { alert(result.message); }
        };
      }
    },

    /* ========================================================================
     * 第 18 节：事件绑定
     * ======================================================================== */

    _bindEvents: function () {
      var self = this;
      /* 键盘快捷键 */
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !self._modalOpen) {
          self.advanceWeek();
        }
      });
    }
  };

  window.RealRender.init();
})();
