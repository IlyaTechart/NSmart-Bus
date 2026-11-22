package rs.trecker

import org.json.JSONArray
import org.json.JSONObject

data class Station(val id: String, val name: String, val code: String, val lat: Double?, val lng: Double?, val lines: List<String>)
data class BusItem(
    val id: String, val kind: String, val base: String, val line: String, val dir: String,
    val dest: String, val title: String, val lat: Double, val lng: Double, val garage: String,
    val roadAligned: Boolean, val age: Long?, val next: String, val dep: String, val routeKey: String,
)
data class Arrival(val kind: String, val base: String, val line: String, val dest: String, val eta: Long, val between: Long?, val dep: String)
data class RouteData(val key: String, val line: String, val base: String, val dir: String, val shape: List<Pair<Double, Double>>, val stops: List<Station>)

fun JSONObject.optText(key: String, fallback: String = ""): String = if (has(key) && !isNull(key)) optString(key, fallback) else fallback
fun JSONObject.optNullableDouble(key: String): Double? = if (has(key) && !isNull(key)) optDouble(key) else null
fun JSONObject.optNullableLong(key: String): Long? = if (has(key) && !isNull(key)) optLong(key) else null

fun parseStations(raw: JSONObject): Map<String, Station> {
    val result = mutableMapOf<String, Station>()
    for (key in raw.keys()) {
        val value = raw.getJSONObject(key)
        val lines = value.optJSONArray("l")?.let { array -> List(array.length()) { array.optString(it) } } ?: emptyList()
        result[key] = Station(key, value.optText("n"), value.optText("c"), value.optNullableDouble("la"), value.optNullableDouble("lo"), lines)
    }
    return result
}

fun parseBusItems(raw: JSONArray): List<BusItem> = List(raw.length()) { index ->
    val value = raw.getJSONObject(index)
    BusItem(
        value.optText("id"), value.optText("kind"), value.optText("base"), value.optText("line"), value.optText("dir"),
        value.optText("dest"), value.optText("title"), value.getDouble("la"), value.getDouble("lo"), value.optText("garage"),
        value.optBoolean("road_aligned"), value.optNullableLong("age"), value.optText("next"), value.optText("dep"), value.optText("rk"),
    )
}

fun parseArrivals(raw: JSONArray): List<Arrival> = List(raw.length()) { index ->
    val value = raw.getJSONObject(index)
    Arrival(value.optText("kind"), value.optText("base"), value.optText("line"), value.optText("dest"), value.optLong("eta"), value.optNullableLong("between"), value.optText("dep"))
}

fun parseRoute(raw: JSONObject, stations: Map<String, Station>): RouteData {
    val route = raw.getJSONObject("route")
    val shape = raw.optJSONArray("shape")?.let { array ->
        List(array.length()) { val point = array.getJSONArray(it); point.getDouble(0) to point.getDouble(1) }
    } ?: emptyList()
    val stops = raw.optJSONArray("stops")?.let { array ->
        List(array.length()) { index ->
            val stop = array.getJSONObject(index); val id = stop.optText("id")
            stations[id] ?: Station(id, stop.optText("name"), "", stop.optNullableDouble("la"), stop.optNullableDouble("lo"), emptyList())
        }
    } ?: emptyList()
    return RouteData(route.optText("k"), route.optText("line"), route.optText("base"), route.optText("dir"), shape, stops)
}

fun JSONArray.stringList(): List<String> = List(length()) { optString(it) }
fun JSONObject.toMap(): Map<String, Any?> = keys().asSequence().associateWith { get(it) }
