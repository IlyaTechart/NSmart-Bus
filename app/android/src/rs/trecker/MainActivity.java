package rs.trecker;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import java.net.URLConnection;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Iterator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The whole app is a web page (assets/www) in a WebView. Java only:
 *  - performs HTTP requests for the page (AndroidNet.request): nsmart/gspns send no CORS headers, so a page could
 *    not read them itself; also allows plain HTTP to gspns.rs;
 *  - asks for the location permission ("where am I" button);
 *  - routes the back button to the page and pauses timers in the background.
 */
public class MainActivity extends Activity {
    private WebView web;
    private final ExecutorService pool = Executors.newFixedThreadPool(4);
    private GeolocationPermissions.Callback geoCallback;
    private String geoOrigin;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window w = getWindow();
        w.setStatusBarColor(Color.parseColor("#fafbf8"));
        if (Build.VERSION.SDK_INT >= 26) w.setNavigationBarColor(Color.WHITE);
        if (Build.VERSION.SDK_INT >= 27) w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        else w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setGeolocationEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setBuiltInZoomControls(false);
        s.setSupportZoom(false);
        s.setUserAgentString(s.getUserAgentString() + " Trecker/1.8");
        web.addJavascriptInterface(new Net(), "AndroidNet");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!"appassets.androidplatform.net".equals(u.getHost())) return null;
                String p = u.getPath();
                if (p == null || !p.startsWith("/assets/www/") || p.contains(".."))
                    return new WebResourceResponse("text/plain", "UTF-8", new java.io.ByteArrayInputStream(new byte[0]));
                try {
                    String mime = URLConnection.guessContentTypeFromName(p);
                    if (p.endsWith(".js")) mime = "application/javascript";
                    if (p.endsWith(".css")) mime = "text/css";
                    return new WebResourceResponse(mime == null ? "application/octet-stream" : mime, "UTF-8", getAssets().open(p.substring(8)));
                } catch (Exception e) {
                    return new WebResourceResponse("text/plain", "UTF-8", new java.io.ByteArrayInputStream(new byte[0]));
                }
            }
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if ("https".equals(u.getScheme()) && "appassets.androidplatform.net".equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (!"https://appassets.androidplatform.net/".equals(origin) && !"https://appassets.androidplatform.net".equals(origin)) {
                    callback.invoke(origin, false, false);
                } else if (hasLocation()) {
                    callback.invoke(origin, true, false);
                } else {
                    geoOrigin = origin;
                    geoCallback = callback;
                    requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION}, 1);
                }
            }
        });
        setContentView(web);
        web.loadUrl("https://appassets.androidplatform.net/assets/www/index.html");
    }

    private boolean hasLocation() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (geoCallback != null) {
            geoCallback.invoke(geoOrigin, hasLocation(), false);
            geoCallback = null;
        }
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("(window.T && T.ui && T.ui.back()) ? 'y' : 'n'", v -> {
            if (v == null || !v.contains("y")) finish();
        });
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
        web.pauseTimers();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        web.resumeTimers();
    }

    @Override
    protected void onDestroy() {
        pool.shutdownNow();
        web.destroy();
        super.onDestroy();
    }

    private void deliver(String id, int status, String text, String retryAfter) {
        final String js = "__httpDone(" + JSONObject.quote(id) + "," + status + "," + JSONObject.quote(text) + ","
                + JSONObject.quote(retryAfter == null ? "" : retryAfter) + ")";
        runOnUiThread(() -> { if (web != null && !isDestroyed()) web.evaluateJavascript(js, null); });
    }

    /** window.AndroidNet in the page. */
    private class Net {
        @JavascriptInterface
        public void request(final String id, final String method, final String url, final String body,
                            final String headersJson, final int timeoutMs) {
            pool.submit(() -> {
                HttpURLConnection c = null;
                try {
                    URL target = new URL(url);
                    String host = target.getHost();
                    if (!("online.nsmart.rs".equals(host) || "gspns.rs".equals(host) || "www.gspns.rs".equals(host))
                            || !("https".equals(target.getProtocol()) || "http".equals(target.getProtocol())))
                        throw new SecurityException("Unsupported data source");
                    c = (HttpURLConnection) target.openConnection();
                    c.setRequestMethod(method);
                    c.setConnectTimeout(Math.min(timeoutMs, 15000));
                    c.setReadTimeout(timeoutMs);
                    c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) Trecker/1.8");
                    c.setRequestProperty("Accept-Language", "sr,en;q=0.8");
                    JSONObject h = new JSONObject(headersJson == null || headersJson.isEmpty() ? "{}" : headersJson);
                    Iterator<String> it = h.keys();
                    while (it.hasNext()) {
                        String k = it.next();
                        c.setRequestProperty(k, h.getString(k));
                    }
                    if ("POST".equals(method)) {
                        c.setDoOutput(true);
                        byte[] b = (body == null ? "" : body).getBytes("UTF-8");
                        c.setFixedLengthStreamingMode(b.length);
                        OutputStream os = c.getOutputStream();
                        os.write(b);
                        os.close();
                    }
                    int code = c.getResponseCode();
                    InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                    String text = "";
                    if (in != null) {
                        ByteArrayOutputStream out = new ByteArrayOutputStream();
                        byte[] buf = new byte[16384];
                        int n;
                        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                        in.close();
                        text = out.toString("UTF-8");
                    }
                    deliver(id, code, text, c.getHeaderField("Retry-After"));
                } catch (Throwable e) {
                    deliver(id, -1, String.valueOf(e.getMessage() != null ? e.getMessage() : e), null);
                } finally {
                    if (c != null) c.disconnect();
                }
            });
        }
    }
}
