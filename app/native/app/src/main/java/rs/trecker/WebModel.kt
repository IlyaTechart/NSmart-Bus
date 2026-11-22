package rs.trecker

import android.app.Activity
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject

/** Only the bundled page is loaded into this WebView. Commands that change
 * polling state run on the same main thread as the repository's callbacks. */
class WebModel(private val activity: Activity, private val web: WebView) {
    private val repo = TreckerRepository(activity)
    private val prefs = activity.getSharedPreferences("trecker_native", Activity.MODE_PRIVATE)
    private var foreground = false
    private var wantsPolling = false
    @Volatile private var closed = false

    init {
        repo.onUpdate = { event ->
            emit("window.transitUpdate && transitUpdate(${JSONObject.quote(event)})")
        }
    }

    private fun emit(script: String) {
        if (!closed) web.evaluateJavascript(script, null)
    }

    private fun onMain(action: () -> Unit) {
        activity.runOnUiThread { if (!closed) action() }
    }

    private fun updatePolling() {
        if (foreground && wantsPolling) repo.start() else repo.stop()
    }

    fun setForeground(value: Boolean) { foreground = value; updatePolling() }
    fun close() { closed = true; repo.close() }

    @JavascriptInterface fun polling(value: Boolean) = onMain { wantsPolling = value; updatePolling() }
    @JavascriptInterface fun focus(base: String) = onMain { repo.setFocus(base.ifEmpty { null }) }
    @JavascriptInterface fun categories(city: Boolean, sub: Boolean) = onMain { repo.setCategories(city, sub) }
    @JavascriptInterface fun viewport(s: Double, n: Double, w: Double, e: Double) = onMain {
        repo.viewport = JSONArray().put(s).put(n).put(w).put(e)
    }
    @JavascriptInterface fun settings(): String = JSONObject()
        .put("language", prefs.getString("language", null))
        .put("city", if (prefs.contains("city")) prefs.getBoolean("city", true) else null)
        .put("sub", if (prefs.contains("suburban")) prefs.getBoolean("suburban", true) else null).toString()
    @JavascriptInterface fun language(english: Boolean) = onMain { repo.setLanguage(english) }
    @JavascriptInterface fun departures(rows: String): String = RustCore.nativeDepartures(rows)
    @JavascriptInterface fun dayType(): String = repo.currentDayType()
    @JavascriptInterface fun catalog(): String = repo.catalog()
    @JavascriptInterface fun routes(): String = repo.routes()
    @JavascriptInterface fun geometry(key: String): String = repo.geometry(key)
    @JavascriptInterface fun snapshot(base: String, city: Boolean, sub: Boolean): String =
        repo.snapshot(base, city, sub)
    @JavascriptInterface fun status(): String = JSONObject()
        .put("ok", repo.lastOkAt).put("error", repo.lastError).put("scheduleError", repo.scheduleError)
        .put("until", JSONObject(repo.gateState()).optLong("blocked_until")).toString()

    private fun reply(id: Int, value: JSONObject?, error: Throwable? = null) {
        emit("window.transitReply && transitReply($id,${value ?: "null"},${JSONObject.quote(error?.message.orEmpty())})")
    }

    @JavascriptInterface fun arrivals(id: Int, uid: String) = onMain {
        repo.arrivals(uid) { reply(id, it) }
    }
    @JavascriptInterface fun timetable(id: Int, rv: String, day: String, force: Boolean) = onMain {
        repo.ensureTable(rv, day, force) { result ->
            result.fold({ reply(id, it) }, { reply(id, null, it) })
        }
    }
}
