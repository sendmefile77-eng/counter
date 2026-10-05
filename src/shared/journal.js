(function installJournal(root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./work') : root.LadWork);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) root.CounterJournal = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function journalFactory(work) {
  const submitted = new Set(['submitted', 'submitted_late', 'submitted_advance']);
  const absent = work.absence;
  const symbols = { pending: '·', submitted: '✓', submitted_late: '◷', submitted_advance: '↗',
    working: 'Р', planned_work: 'П', onsite:'Р', zkp:'ЗКП',training_online:'НО',training_academy:'НА',
    missed: '×', other_tasks: 'ІЗ', personal_permission: 'ОС', sick: 'ЛК', vacation: 'ВП',
    day_off: 'ВГ', holiday: 'СВ', weekend: 'ВХ', outside: '—' };

  function datesBetween(startDate, endDate) {
    const valid = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value))
      && Number.isFinite(Date.parse(`${value}T12:00:00Z`))
      && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
    if (!valid(startDate) || !valid(endDate) || startDate > endDate) throw new Error('Некоректний період табеля.');
    const start = Date.parse(`${startDate}T12:00:00Z`);
    const end = Date.parse(`${endDate}T12:00:00Z`);
    if ((end - start) / 86400000 > 365) throw new Error('Період табеля — до 366 днів.');
    return Array.from({ length: (end - start) / 86400000 + 1 }, (_, i) => new Date(start + i * 86400000).toISOString().slice(0, 10));
  }

  function activeOn(employee, date) {
    if (employee.activePeriods?.length) return employee.activePeriods.some((period) => date >= period.start && (!period.end || date < period.end));
    return date >= employee.createdDate && (!employee.archivedDate || date < employee.archivedDate);
  }

  function cell(state, employee, date, today = work.dateKey()) {
    const key = `${employee.id}|${date}`;
    const record = work.recordForDay(state,employee.id,date,today);
    const override = Boolean(state.workdayOverrides?.[key]);
    const working = (state.settings.workdays || [1, 2, 3, 4, 5]).includes(new Date(`${date}T12:00:00Z`).getUTCDay()) || override;
    const outside = !activeOn(employee, date) && !record && !override;
    const status = outside ? 'outside' : !working ? 'weekend' : record?.status || 'pending';
    const presenceStatus=record?.presenceStatus||'';
    return { employeeId: employee.id, date, status, presenceStatus, symbol: presenceStatus==='zkp'&&submitted.has(status)?'ЗКП✓':override && status === 'pending' ? 'РД' : symbols[status] || '·',
      working, outside, override, protected: Boolean(record?.receiptId), source: record?.source || '',
      note: record?.note || '', documentRef: record?.documentRef || '' };
  }

  function report(state, { startDate, endDate, employeeIds }, today) {
    const dates = datesBetween(startDate, endDate);
    const ids = employeeIds ? new Set(employeeIds) : null;
    const rows = state.employees.filter((employee) => ids ? ids.has(employee.id) : employee.active).map((employee) => {
      const cells = dates.map((date) => cell(state, employee, date, today));
      const count = (fn) => cells.filter(fn).length;
      return { employeeId: employee.id, name: employee.name, cells, totals: {
        submitted: count((item) => item.date<=today&&submitted.has(item.status)), missed: count((item) => item.date<=today&&item.status === 'missed'),
        other: count((item) => item.date<=today&&item.status === 'other_tasks'), absent: count((item) => item.date<=today&&absent.has(item.status)),
        pending: count((item) => item.status === 'pending' && item.date <= today),
        working: count((item) => item.status === 'working' && item.date <= today),
        onsite: count((item) => item.date <= today && (item.presenceStatus||item.status) === 'onsite'),
        zkp: count((item) => item.date <= today && (item.presenceStatus||item.status) === 'zkp'),
        training: count((item) => item.date <= today && ['training_online','training_academy'].includes(item.status)),
        worked: count((item) => item.date <= today && (submitted.has(item.status) || ['other_tasks','working','onsite'].includes(item.status))),
      } };
    });
    return { startDate, endDate, dates, rows, totals: rows.reduce((total, row) => {
      for (const [key, value] of Object.entries(row.totals)) total[key] = (total[key] || 0) + value;
      return total;
    }, { submitted: 0, missed: 0, other: 0, absent: 0, pending: 0, working: 0, onsite: 0, zkp: 0, training:0, worked: 0 }) };
  }

  function rectangle(rows, dates, anchor, target) {
    const firstRow = rows.indexOf(anchor.employeeId);
    const lastRow = rows.indexOf(target.employeeId);
    const firstDay = dates.indexOf(anchor.date);
    const lastDay = dates.indexOf(target.date);
    if ([firstRow, lastRow, firstDay, lastDay].some((index) => index < 0)) return [target];
    return rows.slice(Math.min(firstRow, lastRow), Math.max(firstRow, lastRow) + 1)
      .flatMap((employeeId) => dates.slice(Math.min(firstDay, lastDay), Math.max(firstDay, lastDay) + 1).map((date) => ({ employeeId, date })));
  }

  return { datesBetween, activeOn, cell, report, rectangle };
}));
