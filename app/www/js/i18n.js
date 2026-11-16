(function (T) {
  'use strict';
  const messages = {
    ru: {
      'menu': 'Меню',
      'title.map': 'Город в движении', 'title.lines': 'Маршруты', 'title.timetable': 'Расписание',
      'connection.connecting': 'Подключение', 'connection.paused': 'Пауза', 'connection.online': 'На связи',
      'connection.offline': 'Нет связи', 'connection.estimated': 'Расчёт',
      'drawer.subtitle': 'Автобусы Нови-Сада', 'drawer.data': 'Данные:', 'nav.mapAll': 'Карта всех автобусов', 'nav.chooseBus': 'Выбрать автобус',
      'nav.timetable': 'Расписание', 'nav.main': 'Основная навигация', 'nav.map': 'Карта', 'nav.routes': 'Маршруты',
      'language': 'Язык', 'language.aria': 'Язык приложения',
      'map.show': 'Показывать на карте', 'map.city': 'Городские линии', 'map.suburban': 'Пригородные линии',
      'legend.title': 'Цвета автобусов', 'legend.gps': 'GPS — точное место прямо сейчас',
      'legend.est': 'Расчёт — GPS был недавно, двигаем по маршруту', 'legend.sched': 'По расписанию — GPS нет, место рассчитано',
      'filter.all': 'Все автобусы', 'filter.gps': 'Только GPS', 'map.overview': 'Показать город',
      'map.error': 'Не удалось загрузить карту. Проверьте интернет.', 'retry': 'Повторить',
      'focus.selectedRoute': 'ВЫБРАННЫЙ МАРШРУТ', 'focus.selectedBus': 'ВЫБРАННЫЙ АВТОБУС',
      'focus.busNumber': 'АВТОБУС №{garage}', 'focus.clearVehicle': 'Убрать маршрут выбранного автобуса', 'focus.showAll': 'Показать все',
      'locate': 'Где я', 'panel.collapse': 'Свернуть панель транспорта', 'panel.expand': 'Развернуть панель транспорта',
      'status.cityTransport': 'ТРАНСПОРТ ГОРОДА', 'status.now': 'На карте сейчас', 'status.bus': 'Автобус {base}',
      'status.starting': 'Запуск…', 'status.gettingData': 'Получаем данные о транспорте…',
      'status.retryAfter': 'Запросы приостановлены · повтор через {seconds} с',
      'status.noConnection': 'Нет связи с NSmart · пробуем подключиться', 'status.updated': 'Обновлено {age} · NSmart',
      'status.justNow': 'только что', 'status.timetableUnavailable': 'расписание недоступно',
      'badge.pause': 'ПАУЗА', 'badge.offline': 'ОФЛАЙН', 'badge.estimated': 'РАСЧЁТ', 'badge.loading': 'ЗАГРУЗКА',
      'metric.exact': 'Точная позиция', 'metric.lastGps': 'По последнему GPS', 'metric.estimated': 'Расчёт',
      'metric.timetable': 'Расписание', 'metric.noGps': 'Без GPS',
      'action.chooseRoute': 'Выбрать маршрут', 'action.routeTimetable': 'Расписание маршрута',
      'search.placeholder': 'Номер или район, например 14 или Liman',
      'timetable.city': 'Городские', 'timetable.suburban': 'Пригородные',
      'sheet.stop': 'Остановка', 'sheet.refresh': 'Обновить', 'sheet.close': 'Закрыть расписание остановки',
      'splash.loading': 'Загрузка…', 'loading': 'Загрузка',
      'kind.gps': 'GPS (точно)', 'kind.est': 'Расчёт (GPS был недавно)', 'kind.sched': 'По расписанию (без GPS)',
      'zoom.in': 'Приблизить', 'zoom.out': 'Отдалить', 'cluster.short': 'авто',
      'line': 'Линия {base}', 'popup.destination': 'Куда:', 'popup.variant': 'Вариант:', 'popup.status': 'Статус:',
      'popup.fleet': 'Бортовой №:', 'popup.gpsReceived': 'GPS получен:', 'popup.nextStop': 'Следующая остановка:',
      'popup.trajectory': 'Траектория:', 'popup.trajectoryRoad': 'по дорожной сети между остановками',
      'popup.trajectoryApprox': 'приблизительная, без дорожной привязки', 'popup.departure': 'Отправление с конечной:',
      'popup.schedNote': 'Реального GPS нет: место рассчитано по расписанию gspns и времени в пути из nsmart.',
      'popup.showFullRoute': 'Показать маршрут целиком →', 'popup.routeMissing': 'Маршрут этого автобуса ещё не получен.',
      'popup.approxNote': 'Пунктиром отмечены приблизительные участки между остановками.',
      'time.minutesSecondsAgo': '{minutes} мин {seconds} с назад', 'time.now': 'сейчас', 'time.minutesShort': '{minutes} мин',
      'stop.code': 'Код {code}', 'stop.lines': 'линии: {lines}', 'stop.loading': 'Спрашиваю nsmart…',
      'arrivals.paused': 'Пауза запросов к NSmart до {time}. Показываю расчёт.',
      'arrivals.error': 'NSmart не ответил. Показываю расчёт.', 'arrivals.empty': 'В ближайший час автобусов не видно.',
      'arrivals.estimated': 'расчёт по памяти', 'arrivals.scheduled': 'по расписанию, отпр. {departure}',
      'arrivals.updatePaused': 'Обновление приостановлено до {time}', 'arrivals.availableEstimate': 'Показываю доступный расчёт',
      'arrivals.dataRefresh': 'Данные {time} · обновление не чаще 30 с',
      'lines.variants': 'варианты: {variants}', 'lines.live': 'в пути', 'lines.empty': 'Ничего не найдено',
      'day.R': 'Будний день', 'day.S': 'Суббота', 'day.N': 'Воскресенье', 'day.P': 'Праздник', 'day.today': '(сегодня)',
      'timetable.loading': 'Загружаю расписание с gspns.rs…', 'timetable.loadFailed': 'Не удалось загрузить расписание: {error}',
      'timetable.official': 'Официальное расписание gspns.rs (ДП «Градски саобраћај» Нови-Сад), действует с {date}. Время — отправление с конечной.',
      'timetable.noService': 'нет рейсов', 'timetable.loaded': 'Загружено {date}', 'timetable.reload': 'обновить',
      'timetable.allLines': '‹ Все линии', 'timetable.showMap': 'Показать на карте', 'timetable.direction': 'Направление $2: ',
      'timetable.noDepartures': 'Нет отправлений', 'timetable.legend': 'Обозначения:',
      'timetable.nextPast': 'Зелёным — ближайшее отправление, серым — уже ушедшие.',
      'location.error': 'Не удалось узнать местоположение: {error}', 'startup.error': 'Ошибка запуска: {error}',
      'error.networkTimeout': 'Истекло время ожидания сети', 'error.stopList': 'список остановок: {error}',
      'error.noGspns': 'нет связи с gspns.rs', 'error.timetable': 'расписание: {error}'
    },
    en: {
      'menu': 'Menu',
      'title.map': 'The city in motion', 'title.lines': 'Routes', 'title.timetable': 'Timetable',
      'connection.connecting': 'Connecting', 'connection.paused': 'Paused', 'connection.online': 'Online',
      'connection.offline': 'Offline', 'connection.estimated': 'Estimated',
      'drawer.subtitle': 'Novi Sad buses', 'drawer.data': 'Data:', 'nav.mapAll': 'Map of all buses', 'nav.chooseBus': 'Choose a bus',
      'nav.timetable': 'Timetable', 'nav.main': 'Main navigation', 'nav.map': 'Map', 'nav.routes': 'Routes',
      'language': 'Language', 'language.aria': 'App language',
      'map.show': 'Show on the map', 'map.city': 'City lines', 'map.suburban': 'Suburban lines',
      'legend.title': 'Bus colors', 'legend.gps': 'GPS — precise current location',
      'legend.est': 'Estimated — recent GPS, moving along the route', 'legend.sched': 'Timetable — no GPS, estimated location',
      'filter.all': 'All buses', 'filter.gps': 'GPS only', 'map.overview': 'Show the city',
      'map.error': 'Could not load the map. Check your internet connection.', 'retry': 'Retry',
      'focus.selectedRoute': 'SELECTED ROUTE', 'focus.selectedBus': 'SELECTED BUS',
      'focus.busNumber': 'BUS №{garage}', 'focus.clearVehicle': 'Clear the selected bus route', 'focus.showAll': 'Show all',
      'locate': 'My location', 'panel.collapse': 'Collapse transport panel', 'panel.expand': 'Expand transport panel',
      'status.cityTransport': 'CITY TRANSPORT', 'status.now': 'On the map now', 'status.bus': 'Bus {base}',
      'status.starting': 'Starting…', 'status.gettingData': 'Getting transport data…',
      'status.retryAfter': 'Requests paused · retrying in {seconds} s',
      'status.noConnection': 'No NSmart connection · trying to reconnect', 'status.updated': 'Updated {age} · NSmart',
      'status.justNow': 'just now', 'status.timetableUnavailable': 'timetable unavailable',
      'badge.pause': 'PAUSED', 'badge.offline': 'OFFLINE', 'badge.estimated': 'ESTIMATED', 'badge.loading': 'LOADING',
      'metric.exact': 'Precise position', 'metric.lastGps': 'From the last GPS', 'metric.estimated': 'Estimated',
      'metric.timetable': 'Timetable', 'metric.noGps': 'No GPS',
      'action.chooseRoute': 'Choose a route', 'action.routeTimetable': 'Route timetable',
      'search.placeholder': 'Number or area, for example 14 or Liman',
      'timetable.city': 'City', 'timetable.suburban': 'Suburban',
      'sheet.stop': 'Stop', 'sheet.refresh': 'Refresh', 'sheet.close': 'Close stop timetable',
      'splash.loading': 'Loading…', 'loading': 'Loading',
      'kind.gps': 'GPS (precise)', 'kind.est': 'Estimated (recent GPS)', 'kind.sched': 'Timetable (no GPS)',
      'zoom.in': 'Zoom in', 'zoom.out': 'Zoom out', 'cluster.short': 'bus',
      'line': 'Line {base}', 'popup.destination': 'Destination:', 'popup.variant': 'Variant:', 'popup.status': 'Status:',
      'popup.fleet': 'Fleet №:', 'popup.gpsReceived': 'GPS received:', 'popup.nextStop': 'Next stop:',
      'popup.trajectory': 'Trajectory:', 'popup.trajectoryRoad': 'along the road network between stops',
      'popup.trajectoryApprox': 'approximate, without road snapping', 'popup.departure': 'Terminal departure:',
      'popup.schedNote': 'No live GPS: the location is estimated from the gspns timetable and nsmart travel times.',
      'popup.showFullRoute': 'Show full route →', 'popup.routeMissing': 'The route for this bus has not been received yet.',
      'popup.approxNote': 'Dashed segments are approximate sections between stops.',
      'time.minutesSecondsAgo': '{minutes} min {seconds} s ago', 'time.now': 'now', 'time.minutesShort': '{minutes} min',
      'stop.code': 'Code {code}', 'stop.lines': 'lines: {lines}', 'stop.loading': 'Asking nsmart…',
      'arrivals.paused': 'NSmart requests paused until {time}. Showing estimates.',
      'arrivals.error': 'NSmart did not respond. Showing estimates.', 'arrivals.empty': 'No buses expected in the next hour.',
      'arrivals.estimated': 'estimated from previous data', 'arrivals.scheduled': 'timetable, dep. {departure}',
      'arrivals.updatePaused': 'Updates paused until {time}', 'arrivals.availableEstimate': 'Showing available estimates',
      'arrivals.dataRefresh': 'Data from {time} · refresh at most every 30 s',
      'lines.variants': 'variants: {variants}', 'lines.live': 'live', 'lines.empty': 'Nothing found',
      'day.R': 'Weekday', 'day.S': 'Saturday', 'day.N': 'Sunday', 'day.P': 'Holiday', 'day.today': '(today)',
      'timetable.loading': 'Loading the timetable from gspns.rs…', 'timetable.loadFailed': 'Could not load the timetable: {error}',
      'timetable.official': 'Official gspns.rs timetable (GSP Novi Sad), effective from {date}. Times are terminal departures.',
      'timetable.noService': 'no service', 'timetable.loaded': 'Loaded {date}', 'timetable.reload': 'refresh',
      'timetable.allLines': '‹ All lines', 'timetable.showMap': 'Show on the map', 'timetable.direction': 'Direction $2: ',
      'timetable.noDepartures': 'No departures', 'timetable.legend': 'Legend:',
      'timetable.nextPast': 'Green is the next departure; gray departures have already left.',
      'location.error': 'Could not determine your location: {error}', 'startup.error': 'Startup error: {error}',
      'error.networkTimeout': 'Network request timed out', 'error.stopList': 'stop list: {error}',
      'error.noGspns': 'no connection to gspns.rs', 'error.timetable': 'timetable: {error}'
    }
  };
  const plurals = {
    ru: {
      buses: ['{n} автобус', '{n} автобуса', '{n} автобусов'],
      stops: ['{n} остановка', '{n} остановки', '{n} остановок'],
      departures: ['{n} отправление', '{n} отправления', '{n} отправлений'],
      stopsAway: ['{n} остановка до вас', '{n} остановки до вас', '{n} остановок до вас'],
      secondsAgo: ['{n} секунду назад', '{n} секунды назад', '{n} секунд назад'],
      minutesAgo: ['{n} минуту назад', '{n} минуты назад', '{n} минут назад']
    },
    en: {
      buses: ['{n} bus', '{n} buses'], stops: ['{n} stop', '{n} stops'],
      departures: ['{n} departure', '{n} departures'], stopsAway: ['{n} stop away', '{n} stops away'],
      secondsAgo: ['{n} second ago', '{n} seconds ago'], minutesAgo: ['{n} minute ago', '{n} minutes ago']
    }
  };
  let lang = T.store.get('language', 'ru');
  if (lang !== 'ru' && lang !== 'en') lang = 'ru';
  const listeners = [];
  function format(text, vars) {
    return String(text).replace(/\{(\w+)\}/g, function (_, key) { return vars && vars[key] != null ? vars[key] : ''; });
  }
  function t(key, vars) {
    return format((messages[lang] && messages[lang][key]) || messages.ru[key] || key, vars);
  }
  function count(key, n, vars) {
    const forms = plurals[lang][key];
    let index;
    if (lang === 'ru') {
      const mod10 = Math.abs(n) % 10, mod100 = Math.abs(n) % 100;
      index = mod10 === 1 && mod100 !== 11 ? 0 : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 1 : 2;
    } else index = Math.abs(n) === 1 ? 0 : 1;
    return format(forms[index], Object.assign({ n: n }, vars));
  }
  function apply() {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-aria-label]').forEach(function (el) { el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel)); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) { el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder)); });
    document.querySelectorAll('[data-language]').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.language === lang));
    });
  }
  function set(next) {
    if (next !== 'ru' && next !== 'en') return;
    lang = next;
    T.store.set('language', lang);
    apply();
    listeners.slice().forEach(function (listener) { listener(lang); });
  }
  T.i18n = {
    t: t, count: count, apply: apply, set: set,
    get: function () { return lang; },
    onChange: function (listener) { listeners.push(listener); },
    locale: function () { return lang === 'ru' ? 'ru-RU' : 'en-GB'; }
  };
  apply();
})(globalThis.T = globalThis.T || {});
