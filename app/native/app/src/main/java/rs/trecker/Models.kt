package rs.trecker

import org.json.JSONArray

fun JSONArray.stringList(): List<String> = List(length()) { optString(it) }
