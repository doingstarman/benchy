import { useSyncExternalStore } from 'react'

// Lightweight i18n: a module-level store (mirrors theme.ts / RUNS_CHANGED_EVENT
// patterns) with a useSyncExternalStore hook so a language switch re-renders the
// whole tree — no Context provider to wrap, which keeps tests provider-free.
// Default is English (the dominant chrome + what the component tests assert),
// auto-upgraded to Russian for ru-locale browsers; the choice persists.

export type Lang = 'en' | 'ru'

const STORAGE_KEY = 'benchy-lang'
const listeners = new Set<() => void>()

function detect(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'en' || stored === 'ru') return stored
  } catch { /* localStorage unavailable */ }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ru') ? 'ru' : 'en'
}

let current: Lang = detect()

export function getLang(): Lang {
  return current
}

export function setLang(lang: Lang): void {
  if (lang === current) return
  current = lang
  try { localStorage.setItem(STORAGE_KEY, lang) } catch { /* ignore */ }
  listeners.forEach(fn => fn())
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const entry = DICT[key]
  let out = entry ? entry[current] : key
  if (vars) for (const k in vars) out = out.split(`{${k}}`).join(String(vars[k]))
  return out
}

export function useT(): { t: typeof t; lang: Lang; setLang: typeof setLang } {
  const lang = useSyncExternalStore(subscribe, getLang, getLang)
  void lang // subscription drives the re-render; t() reads the live value
  return { t, lang, setLang }
}

export interface Entry { en: string; ru: string }

// Kept literal (not translated) on purpose — universal ML/technical jargon that
// reads identically in both languages: metric abbreviations (ttfs/time/in/out/
// think), generation params (Temperature/Top P/Top K/Max tokens/…), provider
// preset subtitles, and model capability tags.
// Exported so a test can audit it as data (every key the UI asks for exists, and
// every entry has both languages) — a missing key is otherwise invisible: t()
// just renders the key string at the user.
export const DICT: Record<string, Entry> = {
  // ── nav / chrome ──
  'nav.test': { en: 'Test', ru: 'Тест' },
  'nav.history': { en: 'History', ru: 'История' },
  'nav.dashboard': { en: 'Dashboard', ru: 'Дашборд' },
  'nav.results': { en: 'Results', ru: 'Результаты' },
  'nav.models': { en: 'Models', ru: 'Модели' },
  'nav.providers': { en: 'Providers', ru: 'Провайдеры' },
  'nav.datasets': { en: 'Datasets', ru: 'Датасеты' },
  'nav.settings': { en: 'Settings', ru: 'Настройки' },
  'nav.soon': { en: 'soon', ru: 'скоро' },
  'nav.expand': { en: 'Expand sidebar', ru: 'Развернуть панель' },
  'nav.collapse': { en: 'Collapse sidebar', ru: 'Свернуть панель' },
  'app.backToDialog': { en: 'to dialog', ru: 'в диалог' },

  // ── common ──
  'common.cancel': { en: 'Cancel', ru: 'Отмена' },
  'common.send': { en: 'Send', ru: 'Отправить' },
  'common.save': { en: 'save', ru: 'сохранить' },
  'common.saved': { en: 'saved', ru: 'сохранено' },
  'common.loading': { en: 'Loading…', ru: 'Загрузка…' },
  'common.copy': { en: 'Copy', ru: 'Копировать' },
  'common.close': { en: 'Close', ru: 'Закрыть' },
  'common.expand': { en: 'Expand', ru: 'Развернуть' },
  'common.collapse': { en: 'Collapse', ru: 'Свернуть' },
  'common.on': { en: 'On', ru: 'Вкл' },
  'common.off': { en: 'Off', ru: 'Выкл' },
  'common.error': { en: 'Error', ru: 'Ошибка' },

  // ── settings ──
  'settings.title': { en: 'Settings', ru: 'Настройки' },
  'settings.appearance': { en: 'Appearance', ru: 'Внешний вид' },
  'settings.theme': { en: 'Theme', ru: 'Тема' },
  'settings.themeDark': { en: 'Dark', ru: 'Тёмная' },
  'settings.themeLight': { en: 'Light', ru: 'Светлая' },
  'settings.themeSystem': { en: 'System', ru: 'Система' },
  'settings.language': { en: 'Language', ru: 'Язык' },
  'settings.server': { en: 'Server', ru: 'Сервер' },
  'settings.port': { en: 'Port', ru: 'Порт' },
  'settings.config': { en: 'Config', ru: 'Конфиг' },
  'settings.database': { en: 'Database', ru: 'База данных' },
  'settings.about': { en: 'About', ru: 'О приложении' },
  'settings.build': { en: 'Build', ru: 'Сборка' },
  'settings.checkUpdates': { en: 'Check for updates', ru: 'Проверить обновления' },
  'settings.checking': { en: 'Checking…', ru: 'Проверяю…' },
  'settings.upToDate': { en: 'Up to date', ru: 'Актуальная версия' },
  'settings.devBuild': { en: 'dev build — updates not tracked', ru: 'dev-сборка — обновления не отслеживаются' },
  'settings.checkFailed': { en: "Couldn't reach GitHub — check your connection", ru: 'Не удалось связаться с GitHub — проверь соединение' },
  'settings.noPublished': { en: 'No published build to compare against yet', ru: 'Опубликованной сборки для сравнения пока нет' },
  'slider.setValue': { en: 'Click to set a value', ru: 'Нажми, чтобы задать значение' },
  'slider.resetAuto': { en: 'Click to reset to Auto', ru: 'Нажми, чтобы вернуть Auto' },
  'providers.baseUrl': { en: 'Base URL', ru: 'Base URL' },

  // ── update banner ──
  'update.available': { en: 'A new version of benchy is available', ru: 'Доступна новая версия benchy' },
  'update.runCommand': { en: 'Run this in your terminal, then restart benchy:', ru: 'Выполни в терминале и перезапусти benchy:' },
  'update.showChanges': { en: 'What’s new', ru: 'Что нового' },
  'update.hideChanges': { en: 'Hide', ru: 'Скрыть' },
  'update.dismiss': { en: 'Dismiss', ru: 'Скрыть' },
  'update.copyCommand': { en: 'Copy command', ru: 'Скопировать команду' },
  'update.copied': { en: 'Copied', ru: 'Скопировано' },
  'settings.aboutText': {
    en: 'benchy — a self-hosted tool for benchmarking LLM models.',
    ru: 'benchy — self-hosted инструмент для бенчмаркинга LLM-моделей.',
  },

  // ── history ──
  'history.title': { en: 'History', ru: 'История' },
  'history.newRun': { en: '+ new run', ru: '+ новый тест' },
  'history.searchPrompts': { en: 'Search prompts…', ru: 'Поиск по промптам…' },
  'history.allTime': { en: 'All time', ru: 'Всё время' },
  'history.today': { en: 'Today', ru: 'Сегодня' },
  'history.week': { en: 'This week', ru: 'Эта неделя' },
  'history.all': { en: 'All', ru: 'Все' },
  'history.savedFilter': { en: 'Saved', ru: 'Сохранённые' },
  'history.unsavedFilter': { en: 'Unsaved', ru: 'Несохранённые' },
  'history.colPrompt': { en: 'Prompt', ru: 'Промпт' },
  'history.colModels': { en: 'Models', ru: 'Модели' },
  'history.colCalls': { en: 'Calls', ru: 'Вызовы' },
  'history.colReplies': { en: 'Replies', ru: 'Реплик' },
  'history.colDate': { en: 'Date', ru: 'Дата' },
  'history.colStatus': { en: 'Status', ru: 'Статус' },
  'history.noRuns': { en: 'No runs yet.', ru: 'Пока нет тестов.' },
  'history.namePlaceholder': { en: 'Test name…', ru: 'Название теста…' },
  'history.rename': { en: 'Rename', ru: 'Переименовать' },
  'history.scores': { en: 'scores', ru: 'оценки' },
  'history.fork': { en: 'fork', ru: 'форк' },
  'history.delete': { en: 'delete', ru: 'удалить' },
  'history.confirmDelete': { en: 'Delete this run?', ru: 'Удалить этот тест?' },

  // ── results ──
  'results.backHistory': { en: '← history', ru: '← история' },
  'results.live': { en: 'live', ru: 'вживую' },
  'results.bestTtfs': { en: 'best ttfs', ru: 'лучший ttfs' },
  'results.save': { en: 'save', ru: 'сохранить' },
  'results.saved': { en: 'saved', ru: 'сохранено' },
  'results.customSettings': { en: 'Custom settings', ru: 'Свои настройки' },
  'results.customSettingsGlobal': { en: 'Custom settings (global)', ru: 'Свои настройки (глобально)' },
  'results.modelOverrides': { en: '+ {n} model overrides', ru: '+ переопределений: {n}' },

  // ── providers ──
  'providers.title': { en: 'Providers', ru: 'Провайдеры' },
  'providers.active': { en: 'Active', ru: 'Активные' },
  'providers.local': { en: 'Local', ru: 'Локальные' },
  'providers.custom': { en: 'Custom', ru: 'Свои' },
  'providers.other': { en: 'Other', ru: 'Другие' },
  'providers.customEndpoint': { en: '+ custom endpoint', ru: '+ свой endpoint' },
  'providers.connected': { en: 'Connected', ru: 'Подключено' },
  'providers.apiKey': { en: 'API KEY', ru: 'API-КЛЮЧ' },
  'providers.replaceKey': { en: 'Replace key', ru: 'Заменить ключ' },
  'providers.storedLocally': { en: 'Stored locally', ru: 'Хранится локально' },
  'providers.providerName': { en: 'PROVIDER NAME', ru: 'НАЗВАНИЕ ПРОВАЙДЕРА' },
  'providers.myProvider': { en: 'My Provider', ru: 'Мой провайдер' },
  'providers.models': { en: 'MODELS', ru: 'МОДЕЛИ' },
  'providers.fetchModels': { en: 'Fetch models', ru: 'Загрузить модели' },
  'providers.listMode': { en: 'List', ru: 'Список' },
  'providers.manualMode': { en: 'Manual', ru: 'Вручную' },
  'providers.searchModels': { en: 'Search models...', ru: 'Поиск моделей...' },
  'providers.noModelsMatch': { en: 'No models match', ru: 'Ничего не найдено' },
  'providers.selectedGroup': { en: 'Selected', ru: 'Выбрано' },
  'providers.ofTotal': { en: '{shown} of {total}', ru: '{shown} из {total}' },
  'providers.clickFetch': { en: 'Click "Fetch models" to load available models', ru: 'Нажмите «Загрузить модели», чтобы получить список' },
  'providers.test': { en: 'TEST', ru: 'ТЕСТ' },
  'providers.testModel': { en: 'Test model', ru: 'Модель для теста' },
  'providers.selectModel': { en: '— select a model —', ru: '— выберите модель —' },
  'providers.testing': { en: 'Testing…', ru: 'Проверка…' },
  'providers.testConnection': { en: 'Test connection', ru: 'Проверить' },
  'providers.connectionOk': { en: 'Connection OK', ru: 'Соединение OK' },
  'providers.streamedResponse': { en: 'streamed response received', ru: 'получен потоковый ответ' },
  'providers.advancedDefaults': { en: 'Advanced Defaults', ru: 'Расширенные настройки' },
  'providers.appliedToRuns': { en: 'Applied to new runs unless overridden', ru: 'Применяются к новым тестам, если не переопределены' },
  'providers.generation': { en: 'Generation', ru: 'Генерация' },
  'providers.context': { en: 'Context', ru: 'Контекст' },
  'providers.reliability': { en: 'Reliability', ru: 'Надёжность' },
  'providers.truncation': { en: 'Truncation', ru: 'Обрезка' },
  'providers.streaming': { en: 'Streaming', ru: 'Стриминг' },
  'providers.saveProvider': { en: 'Save provider', ru: 'Сохранить' },
  'providers.saving': { en: 'Saving…', ru: 'Сохранение…' },
  'providers.dangerZone': { en: 'Danger zone', ru: 'Опасная зона' },
  'providers.dangerText': { en: 'Disconnecting will remove this provider and stop any in-flight requests.', ru: 'Отключение удалит провайдера и остановит текущие запросы.' },
  'providers.disconnect': { en: 'Disconnect provider', ru: 'Отключить провайдера' },
  'providers.customProvider': { en: 'Custom provider', ru: 'Свой провайдер' },
  'tile.noModels': { en: 'no models', ru: 'нет моделей' },

  // ── run (NewRun) ──
  'run.title': { en: 'What would you like to test?', ru: 'Что будем тестировать?' },
  'run.addAnotherPrompt': { en: 'Another prompt (runs on its own)…', ru: 'Ещё промпт (выполнится сам по себе)…' },
  'run.mode0': { en: 'one prompt → all models', ru: 'один промпт → все модели' },
  'run.mode1': { en: 'prompt per model', ru: 'промпт на модель' },
  'run.mode2': { en: 'many prompts → all models', ru: 'много промптов → все модели' },
  'run.ask': { en: 'Ask anything…', ru: 'Спросите что угодно…' },
  'run.followup': { en: 'Follow-up or new prompt…', ru: 'Продолжение или новый промпт…' },
  'run.promptForModel': { en: 'Prompt for {model}…', ru: 'Промпт для {model}…' },
  'run.promptN': { en: 'Prompt {n}…', ru: 'Промпт {n}…' },
  'run.addPrompt': { en: '+ add prompt', ru: '+ добавить промпт' },
  'run.run': { en: 'run', ru: 'старт' },
  'run.selected': { en: '{n} selected', ru: 'выбрано: {n}' },
  'run.runSettings': { en: 'Run settings', ru: 'Настройки запуска' },
  'run.waiting': { en: 'Waiting…', ru: 'Ожидание…' },
  'run.noProviders': { en: 'No providers —', ru: 'Нет провайдеров —' },
  'run.needsKey': { en: 'needs a key', ru: 'нужен ключ' },
  'run.needsKeyHint': { en: 'Add an API key in Providers to use this provider', ru: 'Добавьте API-ключ в Провайдерах, чтобы использовать провайдера' },
  'metrics.more': { en: 'More metrics', ru: 'Больше метрик' },
  'trace.thinking': { en: 'Thinking…', ru: 'Думает…' },
  'trace.reasoned': { en: 'Reasoning', ru: 'Размышления' },
  'trace.tokens': { en: '{n} tokens', ru: '{n} токенов' },
  'settings.showReasoning': { en: 'Show reasoning', ru: 'Показывать размышления' },
  'settings.showReasoningHint': {
    en: 'Display what the model thought before answering, where the provider exposes it',
    ru: 'Показывать, о чём модель думала перед ответом, если провайдер это отдаёт',
  },
  'run.reasoningSection': { en: 'Reasoning', ru: 'Размышления' },
  'run.extendedThinking': { en: 'Extended thinking', ru: 'Расширенные размышления' },
  'run.extendedThinkingHint': {
    en: 'Anthropic only thinks when asked — this changes the measurement',
    ru: 'Anthropic думает только по запросу — это меняет замер',
  },
  'run.selectAll': { en: 'select all', ru: 'выбрать все' },
  'run.clearAll': { en: 'clear', ru: 'снять' },
  'run.searchModels': { en: 'Search models…', ru: 'Поиск моделей…' },
  'run.noMatch': { en: 'Nothing matches', ru: 'Ничего не найдено' },
  'run.editHint': { en: 'resending will drop turns after this', ru: 'отправка заново удалит ходы после этого' },
  'run.editHintBatch': { en: 're-runs just this prompt', ru: 'перезапустит только этот промпт' },
  'run.promptLabel': { en: 'Prompt {n}', ru: 'Промпт {n}' },
  'run.allModels': { en: 'all', ru: 'все' },
  'run.resetAll': { en: 'reset all', ru: 'сбросить всё' },
  'run.allModelsTab': { en: 'All models', ru: 'Все модели' },
  'run.inheritsGlobal': { en: '↑ inherits {n} global overrides', ru: '↑ наследует глобальных переопределений: {n}' },
  'run.sendTo': { en: 'Send to', ru: 'Отправить в' },
  'run.callsWord': { en: 'calls', ru: 'вызовов' },
  'run.fastest': { en: 'fastest', ru: 'быстрее всех' },

  // ── titles (tooltips) ──
  'title.remove': { en: 'Remove', ru: 'Убрать' },
  'title.removePrompt': { en: 'Remove prompt', ru: 'Убрать промпт' },
  'title.regenerate': { en: 'Regenerate', ru: 'Перегенерировать' },
  'title.copy': { en: 'Copy', ru: 'Копировать' },
  'title.copyMessage': { en: 'Copy message', ru: 'Копировать сообщение' },
  'title.editMessage': { en: 'Edit message', ru: 'Редактировать сообщение' },
  'title.stopRun': { en: 'Stop run', ru: 'Остановить' },
  'title.runSettings': { en: 'Run settings', ru: 'Настройки запуска' },
  'title.resetInherited': { en: 'Reset to inherited', ru: 'Сбросить к наследуемому' },
  'title.selectAll': { en: 'Select all models', ru: 'Выбрать все модели' },
  'title.deselectAll': { en: 'Deselect all models', ru: 'Снять выбор со всех' },
  'title.attach': { en: 'Attach files (PNG, JPEG, WebP, GIF, PDF — up to 10 MB)', ru: 'Прикрепить файлы (PNG, JPEG, WebP, GIF, PDF — до 10 МБ)' },
  'title.attachSingle': { en: 'Attachments work in single-prompt mode', ru: 'Вложения работают в режиме одного промпта' },
  'title.fastestTtfs': { en: 'Fastest TTFS', ru: 'Самый быстрый TTFS' },

  // ── code block / artifact ──
  'code.copyCode': { en: 'Copy code', ru: 'Копировать код' },
  'code.run': { en: 'Run', ru: 'Запустить' },
  'code.restart': { en: 'Restart', ru: 'Перезапустить' },
  'code.showCode': { en: 'Show code', ru: 'Показать код' },
  'code.artifactPreview': { en: 'Artifact preview', ru: 'Превью артефакта' },
  'code.streaming': { en: 'streaming…', ru: 'стриминг…' },
}
