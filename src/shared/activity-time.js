const ZONE = 'Europe/Kyiv';
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
// UTC instants become the wall-clock coordinates used by the activity engine.
// Intl supplies the offset for the visit's date, including daylight saving.
function kyivWallClock(utcMs) {
  if (!Number.isSafeInteger(utcMs)) throw Error('Некоректна часова мітка історії.');
  const parts = Object.fromEntries(formatter.formatToParts(new Date(utcMs)).map(part => [part.type, part.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second));
}
module.exports = { ZONE, kyivWallClock };
