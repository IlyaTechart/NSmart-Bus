package rs.trecker

object RustCore {
    init { System.loadLibrary("trecker_core") }

    @JvmStatic external fun nativeDayType(timestamp: Long): String
    @JvmStatic external fun nativeVersion(): String
    @JvmStatic external fun nativeParseStations(raw: String): String
    @JvmStatic external fun nativeSetStations(handle: Long, raw: String): String
    @JvmStatic external fun nativeCreate(stations: String, routes: String, roads: String): Long
    @JvmStatic external fun nativeDestroy(handle: Long)
    @JvmStatic external fun nativeObserve(handle: Long, raw: String, now: Long): String
    @JvmStatic external fun nativeSnapshot(handle: Long, now: Long, focus: String, city: Boolean, suburban: Boolean): String
    @JvmStatic external fun nativeRoutes(handle: Long, base: String, now: Long): String
    @JvmStatic external fun nativeRoute(handle: Long, key: String): String
    @JvmStatic external fun nativeLines(handle: Long): String
    @JvmStatic external fun nativeArrivals(handle: Long, raw: String, uid: String, now: Long, receivedAt: Long): String
    @JvmStatic external fun nativePollPlan(handle: Long, focus: String, city: Boolean, suburban: Boolean, viewport: String, polled: String, now: Long): String
    @JvmStatic external fun nativeExportRoutes(handle: Long): String
    @JvmStatic external fun nativeSetTimetable(handle: Long, table: String): String
    @JvmStatic external fun nativeParseIndex(html: String): String
    @JvmStatic external fun nativeParseOptions(html: String): String
    @JvmStatic external fun nativeParseTimetables(html: String): String

    @JvmStatic external fun nativeGateCreate(): Long
    @JvmStatic external fun nativeGateDestroy(handle: Long)
    @JvmStatic external fun nativeGateBegin(handle: Long, now: Long): String
    @JvmStatic external fun nativeGateSuccess(handle: Long)
    @JvmStatic external fun nativeGateFailure(handle: Long, now: Long, status: Long, retryAfter: Long)
    @JvmStatic external fun nativeGateState(handle: Long): String
    @JvmStatic external fun nativeGateRestore(handle: Long, state: String)
}
