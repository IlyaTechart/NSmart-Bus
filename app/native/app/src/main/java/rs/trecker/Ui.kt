package rs.trecker

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

object Ui {
    val GREEN = Color.rgb(23, 102, 85)
    val TEXT = Color.rgb(32, 61, 51)
    val MUTED = Color.rgb(122, 137, 130)
    val BG = Color.rgb(245, 247, 244)

    fun dp(context: Context, value: Float): Int = (value * context.resources.displayMetrics.density).toInt()
    fun text(context: Context, value: String, size: Float = 14f, color: Int = TEXT, bold: Boolean = false): TextView = TextView(context).apply {
        text = value; textSize = size; setTextColor(color); typeface = Typeface.create("sans", if (bold) Typeface.BOLD else Typeface.NORMAL)
    }
    fun column(context: Context, padding: Int = 0): LinearLayout = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL; setPadding(padding, padding, padding, padding)
    }
    fun row(context: Context): LinearLayout = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
    fun button(context: Context, value: String, action: () -> Unit): Button = Button(context).apply {
        text = value; textSize = 13f; setTextColor(GREEN); background = rounded(Color.rgb(237, 243, 231), 12f, context)
        setOnClickListener { action() }
    }
    fun rounded(color: Int, radius: Float, context: Context, stroke: Int? = null): GradientDrawable = GradientDrawable().apply {
        setColor(color); cornerRadius = dp(context, radius).toFloat(); stroke?.let { setStroke(dp(context, 1f), it) }
    }
    fun params(width: Int = LinearLayout.LayoutParams.MATCH_PARENT, height: Int = LinearLayout.LayoutParams.WRAP_CONTENT): LinearLayout.LayoutParams = LinearLayout.LayoutParams(width, height)
    fun View.margins(left: Int = 0, top: Int = 0, right: Int = 0, bottom: Int = 0) {
        (layoutParams as? LinearLayout.LayoutParams)?.setMargins(left, top, right, bottom)
    }
}
