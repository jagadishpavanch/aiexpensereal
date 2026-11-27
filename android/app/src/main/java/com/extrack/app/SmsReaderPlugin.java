package com.extrack.app;

import android.Manifest;
import android.content.Intent;
import android.database.Cursor;
import android.provider.Settings;
import android.provider.Telephony;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONException;

@CapacitorPlugin(name = "SmsReader", permissions = { @Permission(alias = "sms", strings = { Manifest.permission.READ_SMS }) })
public class SmsReaderPlugin extends Plugin {
    /** The running plugin, so the listener can wake the open app. */
    static volatile SmsReaderPlugin live;

    @Override
    public void load() { live = this; }

    @Override
    protected void handleOnDestroy() { if (live == this) live = null; }

    void alertQueued() { notifyListeners("alert", new JSObject()); }

    private JSObject statusObject() {
        JSObject r = new JSObject();
        r.put("sms", getPermissionState("sms").toString());
        r.put("notifications", NotificationManagerCompat.getEnabledListenerPackages(getContext()).contains(getContext().getPackageName()));
        return r;
    }

    @PluginMethod
    public void status(PluginCall call) { call.resolve(statusObject()); }

    @PluginMethod
    public void requestSms(PluginCall call) {
        if (getPermissionState("sms") == PermissionState.GRANTED) {
            call.resolve(statusObject());
            return;
        }
        requestPermissionForAlias("sms", call, "smsPermissionDone");
    }

    @PermissionCallback
    private void smsPermissionDone(PluginCall call) { call.resolve(statusObject()); }

    @PluginMethod
    public void readInbox(PluginCall call) {
        if (getPermissionState("sms") != PermissionState.GRANTED) {
            call.reject("SMS permission not granted", "NO_PERMISSION");
            return;
        }
        long since = call.getLong("since", 0L);
        int limit = call.getInt("limit", 5000);
        String[] cols = { Telephony.Sms._ID, Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE };
        JSArray messages = new JSArray();
        int scanned = 0;
        try (Cursor c = getContext().getContentResolver().query(Telephony.Sms.Inbox.CONTENT_URI, cols, Telephony.Sms.DATE + " > ?", new String[] { String.valueOf(since) }, Telephony.Sms.DATE + " DESC")) {
            while (c != null && c.moveToNext() && scanned < limit) {
                scanned++;
                String body = c.getString(2);
                if (!AlertFilter.mightBeMoney(body)) continue;
                JSObject m = new JSObject();
                m.put("id", c.getString(0));
                m.put("address", c.getString(1) == null ? "" : c.getString(1));
                m.put("body", body);
                m.put("date", c.getLong(3));
                messages.put(m);
            }
        } catch (SecurityException e) {
            call.reject("SMS permission not granted", "NO_PERMISSION");
            return;
        }
        JSObject r = new JSObject();
        r.put("messages", messages);
        r.put("scanned", scanned);
        call.resolve(r);
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    @PluginMethod
    public void queued(PluginCall call) {
        JSObject r = new JSObject();
        r.put("alerts", AlertQueue.all(getContext()));
        call.resolve(r);
    }

    @PluginMethod
    public void ack(PluginCall call) {
        JSArray ids = call.getArray("ids");
        Set<String> set = new HashSet<>();
        try {
            if (ids != null) for (Object o : ids.toList()) set.add(String.valueOf(o));
        } catch (JSONException e) {
            call.reject("Bad ids");
            return;
        }
        AlertQueue.remove(getContext(), set);
        call.resolve();
    }
}
