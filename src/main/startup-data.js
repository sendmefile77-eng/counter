'use strict';

// Updating beside Counter-data keeps that database. A fresh folder must not
// silently acquire an unrelated legacy database from the Windows profile.
async function chooseLegacyData(store, choose) {
  const source = store.legacySource();
  if (!source) return true;
  const answer = await choose({
    type: 'question', title: 'ЛАД · вибір бази',
    message: 'Знайдено попередню базу ЛАД',
    detail: `Попередній файл: ${source}\n\nРобочий файл цієї копії програми: ${store.filePath}\n\nМожна скопіювати попередню базу або почати з порожньої. Попередній файл залишиться на місці.`,
    buttons: ['Скопіювати попередню базу', 'Почати з порожньої бази', 'Закрити'],
    defaultId: 2, cancelId: 2, noLink: true,
  });
  if (answer.response === 0) return true;
  if (answer.response === 1) { store.legacyDirectory = null; return true; }
  return false;
}

module.exports = { chooseLegacyData };
