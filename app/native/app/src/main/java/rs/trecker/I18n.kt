package rs.trecker

object I18n {
    @Volatile var english = false
    fun t(russian: String, english: String): String = if (this.english) english else russian
    fun kind(kind: String): String = when (kind) {
        "gps" -> t("GPS (точно)", "GPS (accurate)")
        "est" -> t("Расчёт по последнему GPS", "Estimated from last GPS")
        else -> t("По расписанию (без GPS)", "Timetable-based (no GPS)")
    }
    fun age(seconds: Long?): String {
        if (seconds == null) return "—"
        if (seconds < 60) return if (english) "$seconds s ago" else "$seconds с назад"
        val minutes = seconds / 60; val rest = seconds % 60
        return if (english) "$minutes min $rest s ago" else "$minutes мин $rest с назад"
    }
}
