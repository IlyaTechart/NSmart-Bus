package rs.trecker

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.app.Dialog
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.location.LocationManager
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Space
import android.widget.TextView
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.layers.SymbolLayer
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.LineString
import org.maplibre.geojson.Point

class MainActivity : Activity() {
    private lateinit var repo: TreckerRepository
    private lateinit var root: FrameLayout
    private lateinit var mapView: MapView
    private lateinit var mapScreen: FrameLayout
    private lateinit var routesScreen: View
    private lateinit var timetableScreen: View
    private lateinit var titleView: TextView
    private lateinit var connectionView: TextView
    private lateinit var statusTitle: TextView
    private lateinit var statusDetails: TextView
    private lateinit var focusView: TextView
    private lateinit var infoCard: LinearLayout
    private lateinit var handler: Handler
    private var map: MapLibreMap? = null
    private var style: Style? = null
    private var busesSource: GeoJsonSource? = null
    private var stopsSource: GeoJsonSource? = null
    private var routeSource: GeoJsonSource? = null
    private var locationSource: GeoJsonSource? = null
    private var selected: BusItem? = null
    private var selectedPosition: BusItem? = null
    private var gpsOnly = false
    private var screen = "map"
    private var routeRv = "rvg"
    private var routeDan = "R"
    private var timetableBase: String? = null
    private var timetableTable: JSONObject? = null
    private var lineItems: JSONArray = JSONArray()
    private var stopDialog: Dialog? = null
    private var currentStop: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(250, 251, 248)
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        MapLibre.getInstance(this)
        handler = Handler(Looper.getMainLooper())
        repo = TreckerRepository(this)
        routeDan = repo.currentDayType()
        repo.onUpdate = { refreshMap() }
        buildUi()
    }

    private fun buildUi() {
        root = FrameLayout(this); root.setBackgroundColor(Ui.BG)
        val top = Ui.row(this).apply {
            setPadding(Ui.dp(this@MainActivity, 10f), Ui.dp(this@MainActivity, 12f), Ui.dp(this@MainActivity, 16f), Ui.dp(this@MainActivity, 10f))
            setBackgroundColor(Color.rgb(250, 251, 248)); elevation = Ui.dp(this@MainActivity, 2f).toFloat()
            addView(Button(this@MainActivity).apply {
                text = "☰"; textSize = 23f; setTextColor(Ui.GREEN); background = null; setOnClickListener { showMenu() }
                layoutParams = LinearLayout.LayoutParams(Ui.dp(this@MainActivity, 48f), Ui.dp(this@MainActivity, 44f))
            })
            addView(Ui.column(this@MainActivity).apply {
                addView(Ui.text(this@MainActivity, "TRECKER / NOVI SAD", 9f, Ui.MUTED, true))
                titleView = Ui.text(this@MainActivity, I18n.t("Город в движении", "City in motion"), 20f, Ui.TEXT, true); addView(titleView)
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            })
            connectionView = Ui.text(this@MainActivity, I18n.t("Подключение", "Connecting"), 10f, Ui.MUTED); addView(connectionView)
        }
        root.addView(top, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, Ui.dp(this, 70f), Gravity.TOP))

        mapScreen = FrameLayout(this); mapView = MapView(this); mapView.onCreate(null)
        mapScreen.addView(mapView, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        buildMapOverlays()
        root.addView(mapScreen, contentParams())
        routesScreen = buildRoutesScreen(); root.addView(routesScreen, contentParams()); routesScreen.visibility = View.GONE
        timetableScreen = FrameLayout(this); root.addView(timetableScreen, contentParams()); timetableScreen.visibility = View.GONE
        buildBottomNavigation()
        setContentView(root)
        mapView.getMapAsync { loaded ->
            map = loaded
            loaded.uiSettings.setAttributionMargins(0, 0, Ui.dp(this, 8f), Ui.dp(this, 8f))
            loaded.cameraPosition = CameraPosition.Builder().target(LatLng(45.2517, 19.8533)).zoom(14.0).build()
            loaded.setStyle(Style.Builder().fromJson(assets.open("map-style.json").bufferedReader().use { it.readText() })) { loadedStyle ->
                style = loadedStyle; setupMapLayers(loadedStyle); refreshMap()
            }
            loaded.addOnMapClickListener { latLng -> handleMapClick(latLng) }
            loaded.addOnCameraIdleListener { updateViewport(); drawSelectedRoute() }
        }
    }

    private fun contentParams(): FrameLayout.LayoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT).apply {
        topMargin = Ui.dp(this@MainActivity, 70f); bottomMargin = Ui.dp(this@MainActivity, 68f)
    }

    private fun buildBottomNavigation() {
        val nav = Ui.row(this).apply { setBackgroundColor(Color.rgb(250, 251, 248)); gravity = Gravity.CENTER }
        listOf(Triple("map", I18n.t("Карта", "Map"), "▦"), Triple("routes", I18n.t("Маршруты", "Routes"), "▣"), Triple("timetable", I18n.t("Расписание", "Timetable"), "◷")).forEach { (target, label, icon) ->
            nav.addView(Button(this).apply {
                text = "$icon\n$label"; textSize = 11f; setTextColor(Ui.GREEN); background = null; gravity = Gravity.CENTER
                setOnClickListener { showScreen(target) }; layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f)
            })
        }
        root.addView(nav, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, Ui.dp(this, 68f), Gravity.BOTTOM))
    }

    private fun buildMapOverlays() {
        val filters = Ui.row(this).apply {
            setPadding(Ui.dp(this@MainActivity, 14f), Ui.dp(this@MainActivity, 10f), Ui.dp(this@MainActivity, 14f), 0)
            addView(Ui.button(this@MainActivity, I18n.t("▣ Все автобусы", "▣ All buses")) { gpsOnly = false; refreshMap() })
            addView(Space(this@MainActivity).apply { layoutParams = LinearLayout.LayoutParams(Ui.dp(this@MainActivity, 8f), 1) })
            addView(Ui.button(this@MainActivity, I18n.t("● Только GPS", "● GPS only")) { gpsOnly = true; refreshMap() })
            addView(Space(this@MainActivity).apply { layoutParams = LinearLayout.LayoutParams(0, 1, 1f) })
            addView(Ui.button(this@MainActivity, "⛶") { map?.cameraPosition = CameraPosition.Builder().target(LatLng(45.2517, 19.8533)).zoom(14.0).build() })
        }
        mapScreen.addView(filters, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP))
        focusView = Ui.text(this, "", 12f, Ui.GREEN, true).apply {
            setPadding(Ui.dp(this@MainActivity, 14f), Ui.dp(this@MainActivity, 12f), Ui.dp(this@MainActivity, 14f), Ui.dp(this@MainActivity, 12f))
            background = Ui.rounded(Color.WHITE, 15f, this@MainActivity); visibility = View.GONE
            setOnClickListener {
                if (selected == null) repo.setFocus(null)
                clearSelection()
            }
        }
        mapScreen.addView(focusView, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP).apply { topMargin = Ui.dp(this@MainActivity, 58f) })
        infoCard = Ui.column(this, Ui.dp(this, 16f)).apply {
            background = Ui.rounded(Color.WHITE, 20f, this@MainActivity); elevation = Ui.dp(this@MainActivity, 8f).toFloat(); visibility = View.GONE
        }
        mapScreen.addView(infoCard, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER).apply {
            marginStart = Ui.dp(this@MainActivity, 24f); marginEnd = Ui.dp(this@MainActivity, 24f)
        })
        val tools = Ui.column(this).apply {
            addView(Ui.button(this@MainActivity, "◎") { locate() })
            addView(Ui.button(this@MainActivity, "+") { map?.animateCamera(CameraUpdateFactory.zoomIn()) })
            addView(Ui.button(this@MainActivity, "−") { map?.animateCamera(CameraUpdateFactory.zoomOut()) })
        }
        mapScreen.addView(tools, FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.END or Gravity.CENTER_VERTICAL).apply { marginEnd = Ui.dp(this@MainActivity, 14f) })
        val status = Ui.column(this, Ui.dp(this, 15f)).apply { background = Ui.rounded(Color.WHITE, 22f, this@MainActivity) }
        statusTitle = Ui.text(this, I18n.t("На карте сейчас", "On the map now"), 18f, Ui.TEXT, true); status.addView(statusTitle)
        statusDetails = Ui.text(this, I18n.t("Запуск…", "Starting…"), 11f, Ui.MUTED); status.addView(statusDetails)
        status.setOnClickListener { statusDetails.visibility = if (statusDetails.visibility == View.VISIBLE) View.GONE else View.VISIBLE }
        mapScreen.addView(status, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM).apply {
            marginStart = Ui.dp(this@MainActivity, 14f); marginEnd = Ui.dp(this@MainActivity, 14f); bottomMargin = Ui.dp(this@MainActivity, 12f)
        })
    }

    private fun setupMapLayers(style: Style) {
        busesSource = GeoJsonSource("buses", FeatureCollection.fromFeatures(emptyList()), org.maplibre.android.style.sources.GeoJsonOptions().withCluster(true).withClusterRadius(38))
        stopsSource = GeoJsonSource("stops", FeatureCollection.fromFeatures(emptyList()))
        routeSource = GeoJsonSource("route", FeatureCollection.fromFeatures(emptyList()))
        locationSource = GeoJsonSource("location", FeatureCollection.fromFeatures(emptyList()))
        style.addSource(routeSource!!); style.addSource(stopsSource!!); style.addSource(busesSource!!); style.addSource(locationSource!!)
        style.addLayer(LineLayer("route-halo", "route").withProperties(PropertyFactory.lineColor(Color.rgb(126, 226, 168)), PropertyFactory.lineWidth(12f), PropertyFactory.lineOpacity(.35f), PropertyFactory.lineCap(org.maplibre.android.style.layers.Property.LINE_CAP_ROUND)))
        style.addLayer(LineLayer("route-line", "route").withProperties(PropertyFactory.lineColor(Color.rgb(8, 127, 91)), PropertyFactory.lineWidth(5f), PropertyFactory.lineCap(org.maplibre.android.style.layers.Property.LINE_CAP_ROUND)))
        style.addLayer(CircleLayer("stops-layer", "stops").withProperties(PropertyFactory.circleRadius(4f), PropertyFactory.circleColor(Color.WHITE), PropertyFactory.circleStrokeColor(Color.rgb(54, 126, 114)), PropertyFactory.circleStrokeWidth(2f)))
        style.addLayer(CircleLayer("clusters", "buses").apply {
            setFilter(Expression.has("point_count"))
        }.withProperties(PropertyFactory.circleColor(Ui.GREEN), PropertyFactory.circleRadius(22f), PropertyFactory.circleStrokeColor(Color.WHITE), PropertyFactory.circleStrokeWidth(2f)))
        style.addLayer(SymbolLayer("cluster-count", "buses").apply { setFilter(Expression.has("point_count")) }.withProperties(
            PropertyFactory.textField(Expression.get("point_count_abbreviated")), PropertyFactory.textSize(13f), PropertyFactory.textColor(Color.WHITE), PropertyFactory.textIgnorePlacement(true), PropertyFactory.textAllowOverlap(true)))
        style.addLayer(SymbolLayer("bus-layer", "buses").apply { setFilter(Expression.not(Expression.has("point_count"))) }.withProperties(
            PropertyFactory.iconImage(Expression.get("icon")), PropertyFactory.iconAllowOverlap(true), PropertyFactory.iconIgnorePlacement(true), PropertyFactory.iconAnchor(org.maplibre.android.style.layers.Property.ICON_ANCHOR_BOTTOM)))
        style.addLayer(CircleLayer("location-layer", "location").withProperties(PropertyFactory.circleRadius(8f), PropertyFactory.circleColor(Color.rgb(26, 115, 232)), PropertyFactory.circleStrokeColor(Color.WHITE), PropertyFactory.circleStrokeWidth(3f)))
    }

    private fun busIcon(item: BusItem, selected: Boolean): String {
        val key = "bus-${item.line}-${item.kind}-$selected"; val currentStyle = style ?: return key
        if (currentStyle.getImage(key) != null) return key
        val density = resources.displayMetrics.density; val width = (58 * density).toInt(); val height = (34 * density).toInt()
        val bitmap = Bitmap.createBitmap(width, height + (7 * density).toInt(), Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap); val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.color = when (item.kind) { "gps" -> Color.rgb(35, 121, 99); "est" -> Color.rgb(189, 143, 69); else -> Color.WHITE }
        canvas.drawRoundRect(RectF(2f, 2f, width - 2f, height - 2f), 9 * density, 9 * density, paint)
        if (selected) { paint.style = Paint.Style.STROKE; paint.strokeWidth = 3 * density; paint.color = Color.rgb(163, 204, 118); canvas.drawRoundRect(RectF(2f, 2f, width - 2f, height - 2f), 9 * density, 9 * density, paint); paint.style = Paint.Style.FILL }
        paint.color = if (item.kind == "sched") Ui.MUTED else Color.WHITE; paint.textSize = 15 * density; paint.textAlign = Paint.Align.CENTER; paint.isFakeBoldText = true
        canvas.drawText(item.line, width / 2f, height * .68f, paint)
        currentStyle.addImage(key, bitmap); return key
    }

    private fun refreshMap() {
        if (screen != "map") return
        val snapshot = repo.snapshot()
        val items = snapshot.filter { !gpsOnly || it.kind == "gps" }
        val latest = items.associateBy { it.id }
        selected?.let { current -> latest[current.id]?.let { selected = it } }
        infoCard.findViewWithTag<TextView>("gps-age")?.let { label ->
            label.text = "${I18n.t("GPS получен", "GPS received")}: ${I18n.age(selected?.age)}"
        }
        updateStatus(snapshot)
        val selectedId = selected?.id
        val features = items.map { item ->
            val shown = if (selectedId == item.id) selectedPosition ?: item else item
            Feature.fromGeometry(Point.fromLngLat(shown.lng, shown.lat)).apply {
                addStringProperty("id", item.id); addStringProperty("icon", busIcon(shown, selectedId == item.id))
            }
        }
        busesSource?.setGeoJson(FeatureCollection.fromFeatures(features))
        drawSelectedRoute()
    }

    private fun drawSelectedRoute() {
        val route = selected?.let { bus ->
            if (bus.routeKey.isNotEmpty()) repo.route(bus.routeKey)
            else repo.routesOf(bus.base).singleOrNull { it.line == bus.line && it.dir == bus.dir }
        }
        val routes = route?.let(::listOf) ?: repo.focus?.let { repo.routesOf(it) } ?: emptyList()
        val routeFeatures = routes.filter { it.shape.size > 1 }.map { routeData ->
            Feature.fromGeometry(LineString.fromLngLats(routeData.shape.map { Point.fromLngLat(it.second, it.first) }))
        }
        routeSource?.setGeoJson(FeatureCollection.fromFeatures(routeFeatures))
        val stopStations = if (routes.isNotEmpty()) routes.flatMap { it.stops }.distinctBy { it.id }
        else if ((map?.cameraPosition?.zoom ?: 0.0) >= 15.0) {
            val bounds = map?.projection?.visibleRegion?.latLngBounds
            repo.stations.values.filter { station ->
                station.lat != null && station.lng != null && (bounds == null ||
                    station.lat!! >= bounds.latitudeSouth && station.lat!! <= bounds.latitudeNorth &&
                    station.lng!! >= bounds.longitudeWest && station.lng!! <= bounds.longitudeEast)
            }.take(600)
        } else emptyList()
        val stopFeatures = stopStations.filter { it.lat != null && it.lng != null }.map { station ->
            Feature.fromGeometry(Point.fromLngLat(station.lng!!, station.lat!!)).apply { addStringProperty("id", station.id) }
        }
        stopsSource?.setGeoJson(FeatureCollection.fromFeatures(stopFeatures))
    }

    private fun handleMapClick(latLng: LatLng): Boolean {
        val nativeMap = map ?: return false; val point = nativeMap.projection.toScreenLocation(latLng)
        val area = RectF(point.x - 25, point.y - 35, point.x + 25, point.y + 15)
        val buses = nativeMap.queryRenderedFeatures(area, "bus-layer")
        if (buses.isNotEmpty()) {
            val id = buses[0].getStringProperty("id")
            repo.snapshot().firstOrNull { it.id == id }?.let { showBus(it) }; return true
        }
        val clusters = nativeMap.queryRenderedFeatures(area, "clusters")
        if (clusters.isNotEmpty()) { nativeMap.animateCamera(CameraUpdateFactory.zoomIn()); return true }
        val stops = nativeMap.queryRenderedFeatures(area, "stops-layer")
        if (stops.isNotEmpty()) { openStop(stops[0].getStringProperty("id")); return true }
        return false
    }

    private fun showBus(item: BusItem) {
        selected = item; selectedPosition = item; infoCard.removeAllViews(); infoCard.visibility = View.VISIBLE
        infoCard.addView(Ui.row(this).apply {
            addView(Ui.text(this@MainActivity, item.title.ifEmpty { I18n.t("Линия ${item.base}", "Line ${item.base}") }, 15f, Ui.TEXT, true).apply { layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f) })
            addView(Button(this@MainActivity).apply { text = "✕"; background = null; setOnClickListener { clearSelection() } })
        })
        fun row(label: String, value: String) {
            if (value.isEmpty()) return
            infoCard.addView(Ui.text(this, "$label: $value", 12f, Ui.MUTED))
        }
        row(I18n.t("Куда", "Destination"), item.dest)
        row(I18n.t("Статус", "Status"), I18n.kind(item.kind))
        if (item.garage.isNotEmpty()) row(I18n.t("Бортовой №", "Fleet no."), item.garage)
        infoCard.addView(Ui.text(this, "${I18n.t("GPS получен", "GPS received")}: ${I18n.age(item.age)}", 12f, Ui.MUTED).apply { tag = "gps-age" })
        row(I18n.t("Следующая остановка", "Next stop"), item.next)
        row(I18n.t("Отправление с конечной", "Terminal departure"), item.dep)
        if (item.kind != "gps") row(I18n.t("Траектория", "Trajectory"), if (item.roadAligned) I18n.t("по дорожной сети", "road-aligned") else I18n.t("приблизительная", "approximate"))
        infoCard.addView(Ui.button(this, I18n.t("Показать маршрут целиком →", "Show full route →")) { showFullRoute() })
        refreshMap()
    }

    private fun clearSelection() {
        selected = null; selectedPosition = null; infoCard.visibility = View.GONE
        if (repo.focus == null) routeSource?.setGeoJson(FeatureCollection.fromFeatures(emptyList()))
        refreshMap()
    }

    private fun showFullRoute() {
        val bus = selected ?: return
        val route = if (bus.routeKey.isNotEmpty()) repo.route(bus.routeKey) else repo.routesOf(bus.base).singleOrNull { it.line == bus.line && it.dir == bus.dir }
        route ?: run { Toast.makeText(this, I18n.t("Маршрут ещё не получен", "Route is not available yet"), Toast.LENGTH_SHORT).show(); return }
        fitRoute(route); infoCard.visibility = View.GONE
    }

    private fun fitRoute(route: RouteData) {
        if (route.shape.isEmpty()) return
        val bounds = LatLngBounds.Builder().includes(route.shape.map { LatLng(it.first, it.second) }).build()
        map?.animateCamera(CameraUpdateFactory.newLatLngBounds(bounds, Ui.dp(this, 60f)))
    }

    private fun updateViewport() {
        val bounds = map?.projection?.visibleRegion?.latLngBounds ?: return
        repo.viewport = JSONArray().put(bounds.latitudeSouth).put(bounds.latitudeNorth).put(bounds.longitudeWest).put(bounds.longitudeEast)
    }

    private fun updateStatus(items: List<BusItem>) {
        val fresh = repo.lastOkAt > 0 && System.currentTimeMillis() - repo.lastOkAt < 30_000
        connectionView.text = when {
            repo.lastError.isNotEmpty() && !fresh -> I18n.t("Нет связи", "Offline")
            fresh -> I18n.t("● На связи", "● Online")
            else -> I18n.t("Расчёт", "Estimated")
        }
        statusTitle.text = repo.focus?.let { I18n.t("Автобус $it", "Bus $it") } ?: I18n.t("На карте сейчас", "On the map now")
        titleView.text = repo.focus?.let { I18n.t("Линия $it", "Line $it") } ?: I18n.t("Город в движении", "City in motion")
        val gps = items.count { it.kind == "gps" }; val est = items.count { it.kind == "est" }; val sched = items.count { it.kind == "sched" }
        statusDetails.text = "GPS $gps · ${I18n.t("Расчёт", "Estimated")} $est · ${I18n.t("Расписание", "Timetable")} $sched" +
            if (repo.lastError.isNotEmpty()) "\n${repo.lastError}" else ""
        focusView.visibility = if (selected != null || repo.focus != null) View.VISIBLE else View.GONE
        focusView.text = selected?.let { "${it.line} · ${it.garage} · ${it.dest}   ✕" } ?: repo.focus?.let { I18n.t("Линия $it · показать все   ✕", "Line $it · show all   ✕") }
    }

    private val tick = object : Runnable {
        override fun run() {
            refreshMap()
            handler.postDelayed(this, 1_000)
        }
    }

    private fun showScreen(target: String) {
        screen = target; mapScreen.visibility = if (target == "map") View.VISIBLE else View.GONE
        routesScreen.visibility = if (target == "routes") View.VISIBLE else View.GONE
        timetableScreen.visibility = if (target == "timetable") View.VISIBLE else View.GONE
        when (target) {
            "map" -> { titleView.text = repo.focus?.let { I18n.t("Линия $it", "Line $it") } ?: I18n.t("Город в движении", "City in motion"); refreshMap() }
            "routes" -> { titleView.text = I18n.t("Маршруты", "Routes"); lineItems = repo.lines(); renderLines((routesScreen as LinearLayout).findViewWithTag("list"), "") }
            "timetable" -> { titleView.text = I18n.t("Расписание", "Timetable"); renderTimetable() }
        }
    }

    private fun buildRoutesScreen(): View {
        val container = Ui.column(this)
        val search = EditText(this).apply {
            hint = I18n.t("Номер или район, например 14 или Liman", "Number or area, e.g. 14 or Liman"); textSize = 15f; inputType = InputType.TYPE_CLASS_TEXT
            setPadding(Ui.dp(this@MainActivity, 16f), 0, Ui.dp(this@MainActivity, 16f), 0)
            addTextChangedListener(object : android.text.TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
                override fun afterTextChanged(s: android.text.Editable?) { renderLines(container.findViewWithTag("list"), s?.toString().orEmpty()) }
            })
        }
        container.addView(search, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, Ui.dp(this, 54f)))
        val scroll = ScrollView(this); val list = Ui.column(this, Ui.dp(this, 12f)).apply { tag = "list" }
        scroll.addView(list); container.addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        return container
    }

    private fun renderLines(list: LinearLayout?, query: String) {
        list ?: return; list.removeAllViews(); val q = query.trim().lowercase()
        for (index in 0 until lineItems.length()) {
            val line = lineItems.getJSONObject(index); val base = line.optString("base")
            if (q.isNotEmpty() && !base.lowercase().startsWith(q) && !(line.optJSONArray("variants") ?: JSONArray()).stringList().any { it.lowercase().contains(q) }) continue
            list.addView(Ui.button(this, "$base   ·   ${line.optInt("stops")} ${I18n.t("остановок", "stops")}") {
                repo.setFocus(base); showScreen("map")
            }.apply { setTextColor(Ui.TEXT); gravity = Gravity.START or Gravity.CENTER_VERTICAL })
        }
        if (list.childCount == 0) list.addView(Ui.text(this, I18n.t("Ничего не найдено", "Nothing found"), 14f, Ui.MUTED))
    }

    private fun renderTimetable() {
        val container = timetableScreen as FrameLayout; container.removeAllViews()
        val column = Ui.column(this, Ui.dp(this, 12f)); val scroll = ScrollView(this); scroll.addView(column); container.addView(scroll)
        val controls = Ui.row(this)
        controls.addView(Ui.button(this, I18n.t("Городские", "Urban")) { routeRv = "rvg"; timetableBase = null; renderTimetable() })
        controls.addView(Ui.button(this, I18n.t("Пригородные", "Suburban")) { routeRv = "rvp"; timetableBase = null; renderTimetable() })
        for (day in listOf("R", "S", "N", "P")) controls.addView(Ui.button(this, day) { routeDan = day; timetableBase = null; renderTimetable() })
        column.addView(android.widget.HorizontalScrollView(this).apply { addView(controls) })
        column.addView(Ui.text(this, "${routeRv.uppercase()} · $routeDan · ${I18n.t("Официальное расписание GSP Novi Sad", "Official GSP Novi Sad timetable")}", 11f, Ui.MUTED))
        val body = Ui.column(this); column.addView(body)
        body.addView(Ui.text(this, I18n.t("Загрузка…", "Loading…"), 14f, Ui.MUTED))
        repo.ensureTable(routeRv, routeDan) { result ->
            result.onSuccess { table ->
                timetableTable = table; body.removeAllViews()
                val base = timetableBase
                if (base == null) {
                    val options = table.getJSONArray("options")
                    for (index in 0 until options.length()) {
                        val option = options.getJSONObject(index); val value = option.optString("value"); val lineBase = value.trimEnd('.', '*')
                        body.addView(Ui.button(this, option.optString("label")) { timetableBase = lineBase; renderTimetable() }.apply { gravity = Gravity.START or Gravity.CENTER_VERTICAL })
                    }
                } else {
                    body.addView(Ui.button(this, I18n.t("‹ Все линии", "‹ All lines")) { timetableBase = null; renderTimetable() })
                    val line = table.getJSONObject("lines").optJSONObject(base)
                    if (line == null) body.addView(Ui.text(this, I18n.t("Нет рейсов", "No service"), 15f, Ui.MUTED))
                    else {
                        body.addView(Ui.text(this, line.optString("title"), 17f, Ui.TEXT, true))
                        val directions = line.getJSONArray("directions")
                        for (i in 0 until directions.length()) {
                            val direction = directions.getJSONObject(i); body.addView(Ui.text(this, direction.optString("header"), 14f, Ui.GREEN, true))
                            val departures = direction.getJSONArray("departures"); val text = StringBuilder()
                            for (j in 0 until departures.length()) {
                                val dep = departures.getJSONObject(j); text.append(dep.optString("t")); if (!dep.isNull("mark")) text.append(dep.optString("mark")); text.append("   ")
                                if (j % 6 == 5) text.append('\n')
                            }
                            body.addView(Ui.text(this, text.toString(), 14f, Ui.TEXT))
                        }
                        body.addView(Ui.text(this, line.optString("legend"), 11f, Ui.MUTED))
                    }
                }
            }.onFailure { error ->
                body.removeAllViews(); body.addView(Ui.text(this, error.message ?: error.toString(), 14f, Color.RED))
                body.addView(Ui.button(this, I18n.t("Повторить", "Retry")) { renderTimetable() })
            }
        }
    }

    private fun openStop(uid: String) {
        currentStop = uid; val station = repo.stations[uid] ?: return
        val dialog = Dialog(this); stopDialog = dialog
        val column = Ui.column(this, Ui.dp(this, 18f))
        column.addView(Ui.row(this).apply {
            addView(Ui.text(this@MainActivity, station.name, 17f, Ui.TEXT, true).apply { layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f) })
            addView(Button(this@MainActivity).apply { text = "✕"; background = null; setOnClickListener { dialog.dismiss() } })
        })
        column.addView(Ui.text(this, "${station.code} · ${station.lines.joinToString()}", 11f, Ui.MUTED))
        val body = Ui.column(this); body.addView(Ui.text(this, I18n.t("Загрузка…", "Loading…"), 14f, Ui.MUTED)); column.addView(body)
        dialog.setContentView(ScrollView(this).apply { addView(column) })
        dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        dialog.setOnDismissListener { if (currentStop == uid) currentStop = null }
        dialog.show(); loadArrivals(uid, body)
    }

    private fun loadArrivals(uid: String, body: LinearLayout) {
        repo.arrivals(uid) { result ->
            if (currentStop != uid) return@arrivals
            body.removeAllViews()
            if (result.optString("error").isNotEmpty()) body.addView(Ui.text(this, result.optString("error"), 12f, Color.RED))
            val arrivals = parseArrivals(result.optJSONArray("list") ?: JSONArray())
            if (arrivals.isEmpty()) body.addView(Ui.text(this, I18n.t("В ближайший час автобусов не видно", "No buses expected in the next hour"), 13f, Ui.MUTED))
            for (arrival in arrivals.take(30)) {
                val minutes = if (arrival.eta < 60) I18n.t("сейчас", "now") else "${arrival.eta / 60} ${I18n.t("мин", "min")}"
                body.addView(Ui.text(this, "${arrival.base}  ${arrival.dest}   ·   $minutes", 14f, Ui.TEXT, true))
                body.addView(Ui.text(this, "${I18n.kind(arrival.kind)}${arrival.between?.let { " · $it" } ?: ""}", 10f, Ui.MUTED))
            }
        }
    }

    private fun showMenu() {
        val column = Ui.column(this, Ui.dp(this, 20f))
        column.addView(Ui.text(this, "Trecker NS", 22f, Ui.TEXT, true))
        column.addView(Ui.text(this, I18n.t("Язык / Language", "Language / Язык"), 13f, Ui.MUTED, true))
        column.addView(Ui.row(this).apply {
            addView(Ui.button(this@MainActivity, "Русский") { repo.setLanguage(false); recreate() })
            addView(Ui.button(this@MainActivity, "English") { repo.setLanguage(true); recreate() })
        })
        column.addView(CheckBox(this).apply { text = I18n.t("Городские линии", "Urban lines"); isChecked = repo.city; setOnCheckedChangeListener { _, checked -> repo.setCategories(checked, repo.suburban) } })
        column.addView(CheckBox(this).apply { text = I18n.t("Пригородные линии", "Suburban lines"); isChecked = repo.suburban; setOnCheckedChangeListener { _, checked -> repo.setCategories(repo.city, checked) } })
        column.addView(Ui.text(this, I18n.t("GPS — точное место\nРасчёт — по последнему GPS\nРасписание — без GPS", "GPS — accurate position\nEstimated — from last GPS\nTimetable — no GPS"), 13f, Ui.MUTED))
        column.addView(Ui.text(this, "Данные / Data: online.nsmart.rs, gspns.rs\n${RustCore.nativeVersion()}", 11f, Ui.MUTED))
        column.addView(Ui.button(this, "GitHub / OpenStreetMap") { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/IlyaTechart/NSmart-Bus"))) })
        AlertDialog.Builder(this).setView(column).setNegativeButton(I18n.t("Закрыть", "Close"), null).show()
    }

    private fun locate() {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED && checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), 1); return
        }
        try {
            val manager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
            manager.getLastKnownLocation(LocationManager.GPS_PROVIDER)?.let { showLocation(it.latitude, it.longitude) }
            manager.requestSingleUpdate(LocationManager.GPS_PROVIDER, { location -> showLocation(location.latitude, location.longitude) }, handler.looper)
        } catch (error: Exception) { Toast.makeText(this, error.message, Toast.LENGTH_SHORT).show() }
    }

    private fun showLocation(latitude: Double, longitude: Double) {
        locationSource?.setGeoJson(Feature.fromGeometry(Point.fromLngLat(longitude, latitude)))
        map?.animateCamera(CameraUpdateFactory.newLatLngZoom(LatLng(latitude, longitude), 16.0))
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (grantResults.any { it == PackageManager.PERMISSION_GRANTED }) locate()
    }

    override fun onBackPressed() {
        when {
            stopDialog?.isShowing == true -> stopDialog?.dismiss()
            infoCard.visibility == View.VISIBLE -> clearSelection()
            screen != "map" -> showScreen("map")
            selected != null -> clearSelection()
            repo.focus != null -> { repo.setFocus(null); refreshMap() }
            else -> super.onBackPressed()
        }
    }

    override fun onStart() { super.onStart(); mapView.onStart() }
    override fun onResume() { super.onResume(); mapView.onResume(); repo.start(); handler.post(tick) }
    override fun onPause() { handler.removeCallbacks(tick); repo.stop(); mapView.onPause(); super.onPause() }
    override fun onStop() { mapView.onStop(); super.onStop() }
    override fun onLowMemory() { super.onLowMemory(); mapView.onLowMemory() }
    override fun onDestroy() { handler.removeCallbacksAndMessages(null); repo.close(); mapView.onDestroy(); super.onDestroy() }
    override fun onSaveInstanceState(outState: Bundle) { super.onSaveInstanceState(outState); mapView.onSaveInstanceState(outState) }
}
