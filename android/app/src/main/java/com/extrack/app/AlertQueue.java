package com.extrack.app;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Alerts caught while ExTrack was closed. Bounded (oldest dropped first) and removed only after the app saved them. */
final class AlertQueue {
    private static final String PREFS = "extrack_alerts";
    private static final String KEY = "queue";
    static final int MAX = 500;

    private AlertQueue() {}

    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    private static JSONArray read(Context c) {
        try {
            return new JSONArray(prefs(c).getString(KEY, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    static synchronized void add(Context c, JSONObject alert) {
        JSONArray q = read(c);
        String id = alert.optString("id");
        for (int i = 0; i < q.length(); i++) {
            JSONObject a = q.optJSONObject(i);
            if (a != null && id.equals(a.optString("id"))) return;
        }
        q.put(alert);
        while (q.length() > MAX) q.remove(0);
        prefs(c).edit().putString(KEY, q.toString()).apply();
    }

    static synchronized JSONArray all(Context c) { return read(c); }

    static synchronized void remove(Context c, Set<String> ids) {
        JSONArray q = read(c);
        JSONArray keep = new JSONArray();
        for (int i = 0; i < q.length(); i++) {
            JSONObject a = q.optJSONObject(i);
            if (a != null && !ids.contains(a.optString("id"))) keep.put(a);
        }
        prefs(c).edit().putString(KEY, keep.toString()).apply();
    }
}
