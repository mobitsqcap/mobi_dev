'use strict';

const DEFAULT_TIME_ZONE = 'Asia/Calcutta';

function localDateParts(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, value])
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day)
  };
}

function isoDateFromUtcDate(date) {
  return date.toISOString().slice(0, 10);
}

function lastCompletedCalendarWeek({ now = new Date(), timeZone = DEFAULT_TIME_ZONE } = {}) {
  const local = localDateParts(now, timeZone);
  // Use a UTC date solely as a date arithmetic container. It is not the
  // timestamp sent to SAP; LastChangeDate is an Edm.DateTime date/time value.
  const current = new Date(Date.UTC(local.year, local.month - 1, local.day));
  const dayOfWeek = current.getUTCDay(); // Sunday=0, Monday=1
  const daysSinceMonday = (dayOfWeek + 6) % 7;

  const start = new Date(current);
  start.setUTCDate(current.getUTCDate() - 7);
  const end = new Date(start);
  end.setUTCDate(current.getUTCDate() + 1);

  const fromDate = isoDateFromUtcDate(start);
  const toDate = isoDateFromUtcDate(end);

  return {
    fromDate,
    toDate,
    // SAP S/4HANA OData V2 Edm.DateTime literals are timezone-less.
    fromLiteral: `${fromDate}T00:00:00`,
    toLiteral: `${toDate}T00:00:00`,
    timeZone
  };
}

module.exports = {
  lastCompletedCalendarWeek,
  localDateParts
};
