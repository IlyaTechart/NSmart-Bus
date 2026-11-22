package rs.trecker

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

data class StopResult(val raw: String, val receivedAt: Long, val error: String = "", val fromNetwork: Boolean = false, val cached: Boolean = false)

class TreckerRepository(context: Context) {
    private val app = context.applicationContext
    private val prefs = app.getSharedPreferences("trecker_native", Context.MODE_PRIVATE)
    private val main = Handler(Looper.getMainLooper())
    private val nsmartExecutor = Executors.newSingleThreadExecutor()
    private val scheduleExecutor = Executors.newSingleThreadExecutor()
    private val closed = AtomicBoolean(false)
    private val cache = mutableMapOf<String, StopResult>()
    private val polledAt = mutableMapOf<String, Long>()
    private var engine: Long = 0
    private val gate = RustCore.nativeGateCreate()
    private var queue = mutableListOf<String>()
    private var cycleStarted = 0L
    private var pollPosted = false
    private var stationsAt = prefs.getLong("stations_at", 0)
    @Volatile private var scheduleIndex: JSONObject? = null
    private var scheduleLoading = false

    var stations: Map<String, Station> = emptyMap(); private set
    var focus: String? = null; private set
    var city = prefs.getBoolean("city", true)
    var suburban = prefs.getBoolean("suburban", true)
    @Volatile var active = false
    var lastOkAt = 0L
    var lastError = ""
    var viewport: JSONArray = JSONArray()
    var onUpdate: () -> Unit = {}

    init {
        I18n.english = prefs.getString("language", "ru") == "en"
        val savedStations = prefs.getString("stations", null)
        val stationJson = savedStations ?: readAsset("stations.json")
        stations = parseStations(JSONObject(stationJson))
        val routes = prefs.getString("routes", null) ?: readAsset("routes.json")
        engine = RustCore.nativeCreate(stationJson, routes, readAsset("roads.json"))
        prefs.getString("gate", null)?.let { RustCore.nativeGateRestore(gate, it) }
        prefs.getString("schedule_index", null)?.let { scheduleIndex = JSONObject(it) }
        restoreTimetables()
    }

    private fun readAsset(name: String): String = app.assets.open(name).bufferedReader().use { it.readText() }
    private fun now(): Long = System.currentTimeMillis()
    private fun saveGate() = prefs.edit().putString("gate", RustCore.nativeGateState(gate)).apply()
    private fun notifyUpdate() = main.post { if (!closed.get()) onUpdate() }

    fun setLanguage(english: Boolean) {
        I18n.english = english; prefs.edit().putString("language", if (english) "en" else "ru").apply()
    }
    fun setCategories(city: Boolean, suburban: Boolean) {
        this.city = city; this.suburban = suburban
        prefs.edit().putBoolean("city", city).putBoolean("suburban", suburban).apply(); queue.clear(); notifyUpdate()
    }
    fun setFocus(base: String?) { focus = base; queue.clear(); notifyUpdate() }

    fun start() {
        if (closed.get() || active) return
        active = true
        if (stations.isEmpty()) refreshStations()
        else if (now() - stationsAt > 14 * 86_400_000L) main.postDelayed(refreshTask, 12_000)
        pollNext()
        scheduleExecutor.execute { loadScheduleBackground() }
    }

    private val refreshTask = Runnable { if (active && !closed.get()) refreshStations() }

    fun stop() { active = false; main.removeCallbacks(refreshTask); main.removeCallbacks(pollTask); pollPosted = false }

    fun close() {
        if (!closed.compareAndSet(false, true)) return
        stop(); saveRoutes(); nsmartExecutor.shutdownNow(); scheduleExecutor.shutdownNow()
        Thread {
            for (executor in listOf(nsmartExecutor, scheduleExecutor)) {
                while (!executor.awaitTermination(1, java.util.concurrent.TimeUnit.MINUTES)) continue
            }
            RustCore.nativeDestroy(engine)
            RustCore.nativeGateDestroy(gate)
        }.start()
    }

    private val pollTask = object : Runnable {
        override fun run() { pollPosted = false; pollNext() }
    }
    private fun schedulePoll(delay: Long) {
        if (!active || pollPosted || closed.get()) return
        pollPosted = true; main.postDelayed(pollTask, delay)
    }

    private fun pollNext() {
        if (!active || closed.get()) return
        if (queue.isEmpty()) {
            if (cycleStarted > 0 && now() - cycleStarted < 40_000) { schedulePoll(750); return }
            queue = RustCore.nativePollPlan(engine, focus.orEmpty(), city, suburban, viewport.toString(), JSONObject(polledAt as Map<*, *>).toString(), now())
                .let(::JSONArray).stringList().toMutableList()
            cycleStarted = now(); saveRoutes()
            if (queue.isEmpty()) { schedulePoll(3_000); return }
        }
        val uid = queue.removeAt(0); polledAt[uid] = now()
        fetchStop(uid) { result ->
            if (result.fromNetwork) {
                if (result.error.isEmpty()) { lastOkAt = maxOf(lastOkAt, result.receivedAt); lastError = "" }
                else lastError = result.error
                notifyUpdate()
            }
            schedulePoll(if (result.fromNetwork) 0 else 250)
        }
    }

    fun fetchStop(uid: String, force: Boolean = false, callback: (StopResult) -> Unit) {
        nsmartExecutor.execute {
            val cached = cache[uid]
            if (!force && cached != null && now() - cached.receivedAt < 30_000) {
                main.post { if (!closed.get()) callback(cached.copy(cached = true, fromNetwork = false)) }; return@execute
            }
            while (active && !closed.get()) {
                val decision = JSONObject(RustCore.nativeGateBegin(gate, now()))
                if (decision.optBoolean("allowed")) break
                try { Thread.sleep(decision.optLong("waitMs").coerceIn(100, 1_000)) } catch (_: InterruptedException) { return@execute }
            }
            if (!active || closed.get()) {
                main.post { if (!closed.get()) callback(StopResult("", now(), "paused")) }; return@execute
            }
            saveGate()
            val result = try {
                val body = "station_uid=${Network.encode(uid)}&ibfm=TS001831&direction=2&company_info_id=216&radius="
                val response = Network.request("POST", "https://online.nsmart.rs/sr/najava-dolaska/", body,
                    mapOf("X-Requested-With" to "XMLHttpRequest", "Content-Type" to "application/x-www-form-urlencoded; charset=UTF-8"), 15_000)
                if (response.status != 200) {
                    RustCore.nativeGateFailure(gate, now(), response.status.toLong(), response.retryAfter ?: -1)
                    StopResult("", now(), "nsmart HTTP ${response.status}", true)
                } else {
                    RustCore.nativeObserve(engine, response.text, now())
                    val rawObject = JSONArray(response.text)
                    if (rawObject.length() == 0 || rawObject.opt(0) == false) {
                        RustCore.nativeGateFailure(gate, now(), 0, -1)
                        StopResult(response.text, now(), "invalid response", true)
                    } else {
                        RustCore.nativeGateSuccess(gate)
                        StopResult(response.text, now(), fromNetwork = true)
                    }
                }
            } catch (error: Exception) {
                RustCore.nativeGateFailure(gate, now(), 0, -1)
                StopResult("", now(), error.message ?: error.toString(), true)
            }
            saveGate()
            if (result.error.isEmpty()) {
                cache.remove(uid); cache[uid] = result
                if (cache.size > 128) cache.remove(cache.keys.first())
            }
            main.post { if (!closed.get()) callback(result) }
        }
    }

    private fun refreshStations() {
        nsmartExecutor.execute {
            try {
                while (active && !closed.get()) {
                    val decision = JSONObject(RustCore.nativeGateBegin(gate, now()))
                    if (decision.optBoolean("allowed")) break
                    Thread.sleep(decision.optLong("waitMs").coerceIn(100, 1_000))
                }
                if (!active || closed.get()) return@execute
                saveGate()
                val response = Network.request("POST", "https://online.nsmart.rs/sr/AnnouncementForStation/getAllStations", "", timeout = 60_000)
                if (response.status == 200) {
                    val compact = RustCore.nativeParseStations(response.text)
                    RustCore.nativeSetStations(engine, compact); RustCore.nativeGateSuccess(gate)
                    val updated = parseStations(JSONObject(compact)); val receivedAt = now()
                    prefs.edit().putString("stations", compact).putLong("stations_at", receivedAt).apply()
                    main.post {
                        if (!closed.get()) {
                            stations = updated
                            stationsAt = receivedAt
                            queue.clear()
                            onUpdate()
                        }
                    }
                } else {
                    RustCore.nativeGateFailure(gate, now(), response.status.toLong(), response.retryAfter ?: -1)
                    lastError = "nsmart HTTP ${response.status}"
                }
                saveGate()
            } catch (error: Exception) {
                RustCore.nativeGateFailure(gate, now(), 0, -1); saveGate()
                lastError = error.message.orEmpty(); notifyUpdate()
            }
        }
    }

    fun snapshot(): List<BusItem> = parseBusItems(JSONArray(RustCore.nativeSnapshot(engine, now(), focus.orEmpty(), city, suburban)))
    fun lines(): JSONArray = JSONArray(RustCore.nativeLines(engine))
    fun route(key: String): RouteData? {
        val raw = RustCore.nativeRoute(engine, key)
        return if (raw == "null") null else parseRoute(JSONObject(raw), stations)
    }
    fun routesOf(base: String): List<RouteData> = JSONArray(RustCore.nativeRoutes(engine, base, now())).let { array ->
        List(array.length()) { parseRoute(array.getJSONObject(it), stations) }
    }
    fun saveRoutes() {
        if (engine != 0L) prefs.edit().putString("routes", RustCore.nativeExportRoutes(engine)).apply()
    }

    fun arrivals(uid: String, callback: (JSONObject) -> Unit) {
        fetchStop(uid) { result ->
            if (result.error.isNotEmpty()) {
                callback(JSONObject().put("error", result.error).put("list", JSONArray()).put("at", now()).put("dataAt", result.receivedAt))
            } else {
                try { callback(JSONObject(RustCore.nativeArrivals(engine, result.raw, uid, now(), result.receivedAt))) }
                catch (error: Exception) { callback(JSONObject().put("error", error.message).put("list", JSONArray())) }
            }
        }
    }

    private fun belgradeDay(timestamp: Long = now()): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("Europe/Belgrade")
    }.format(Date(timestamp))

    private fun loadIndexBackground(force: Boolean = false): JSONObject {
        val today = belgradeDay()
        val existing = scheduleIndex
        if (!force && existing != null && existing.optString("day") == today) return existing
        return try {
            val html = Network.request("GET", "https://gspns.rs/red-voznje/gradski?selected_lang=lat", timeout = 25_000)
            require(html.status == 200) { "gspns HTTP ${html.status}" }
            val index = RustCore.nativeParseIndex(html.text).let(::JSONObject)
            index.put("day", today).put("at", now()); scheduleIndex = index
            prefs.edit().putString("schedule_index", index.toString()).apply(); index
        } catch (error: Exception) {
            if (existing != null) existing else throw error
        }
    }

    fun currentDayType(timestamp: Long = now()): String {
        val index = scheduleIndex
        if (index != null && index.optString("day") == belgradeDay(timestamp)) {
            val dayType = index.optString("dayType")
            if (dayType in setOf("R", "S", "N", "P")) return dayType
        }
        return RustCore.nativeDayType(timestamp)
    }

    private fun vaziod(index: JSONObject): String {
        val dates = index.optJSONArray("vaziod") ?: JSONArray(); val today = belgradeDay()
        val values = dates.stringList().sorted(); return values.lastOrNull { it <= today } ?: values.firstOrNull() ?: today
    }

    fun ensureTable(rv: String, dan: String, force: Boolean = false, callback: (Result<JSONObject>) -> Unit) {
        scheduleExecutor.execute {
            try { callbackOnMain(callback, Result.success(ensureTableBackground(rv, dan, force))) }
            catch (error: Exception) { callbackOnMain(callback, Result.failure(error)) }
        }
    }
    private fun callbackOnMain(callback: (Result<JSONObject>) -> Unit, result: Result<JSONObject>) = main.post {
        if (!closed.get()) callback(result)
    }

    private fun ensureTableBackground(rv: String, dan: String, force: Boolean): JSONObject {
        val index = loadIndexBackground(); val date = vaziod(index); val key = "tt2|$date|$rv|$dan"
        val cached = prefs.getString(key, null)?.let(::JSONObject)
        if (!force && cached != null && now() - cached.optLong("fetched") < 7 * 86_400_000L) {
            RustCore.nativeSetTimetable(engine, cached.toString()); return cached
        }
        Thread.sleep(1_000)
        val optionsUrl = "https://gspns.rs/red-voznje/lista-linija?" + Network.query(mapOf("rv" to rv, "vaziod" to date, "dan" to dan))
        val optionsResponse = Network.request("GET", optionsUrl, timeout = 25_000)
        require(optionsResponse.status == 200) { "gspns HTTP ${optionsResponse.status}" }
        val options = JSONArray(RustCore.nativeParseOptions(optionsResponse.text))
        Thread.sleep(1_000)
        val values = List(options.length()) { options.getJSONObject(it).getString("value") }
        val tableUrl = "https://gspns.rs/red-voznje/ispis-polazaka?" + Network.query(mapOf("rv" to rv, "vaziod" to date, "dan" to dan, "linija[]" to values))
        val tableResponse = Network.request("GET", tableUrl, timeout = 25_000)
        require(tableResponse.status == 200) { "gspns HTTP ${tableResponse.status}" }
        val table = JSONObject().put("key", key).put("rv", rv).put("dan", dan).put("vaziod", date).put("fetched", now())
            .put("options", options).put("lines", JSONObject(RustCore.nativeParseTimetables(tableResponse.text)))
        prefs.edit().putString(key, table.toString()).apply(); RustCore.nativeSetTimetable(engine, table.toString()); return table
    }

    private fun loadScheduleBackground() {
        if (scheduleLoading) return
        scheduleLoading = true
        try {
            loadIndexBackground()
            val calendar = java.util.Calendar.getInstance(TimeZone.getTimeZone("Europe/Belgrade"))
            val days = mutableSetOf(currentDayType(calendar.timeInMillis))
            if (calendar.get(java.util.Calendar.HOUR_OF_DAY) < 5) {
                calendar.add(java.util.Calendar.DATE, -1)
                days += currentDayType(calendar.timeInMillis)
            }
            for (dan in days) for (rv in listOf("rvg", "rvp")) ensureTableBackground(rv, dan, false)
            lastError = ""
        } catch (error: Exception) { lastError = error.message.orEmpty() }
        finally { scheduleLoading = false }
    }

    private fun restoreTimetables() {
        for (rv in listOf("rvg", "rvp")) for (dan in listOf("R", "S", "N", "P")) {
            val keys = prefs.all.keys.filter { it.startsWith("tt2|") && it.endsWith("|$rv|$dan") }.sorted()
            val latest = keys.lastOrNull() ?: continue
            prefs.getString(latest, null)?.let {
                try { RustCore.nativeSetTimetable(engine, it) } catch (_: Exception) {}
            }
        }
    }
}
