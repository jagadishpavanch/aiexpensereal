package com.extrack.app;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import org.json.JSONException;
import org.json.JSONObject;

/** Keeps money alerts from SMS, bank and UPI apps in an on-phone queue. Nothing is sent anywhere from here. */
public class BankNotificationListener extends NotificationListenerService {
    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        String pkg = sbn.getPackageName();
        if (!AlertFilter.isWatched(pkg)) return;
        Notification n = sbn.getNotification();
        if ((n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
        Bundle x = n.extras;
        CharSequence big = x.getCharSequence(Notification.EXTRA_BIG_TEXT);
        CharSequence text = big != null ? big : x.getCharSequence(Notification.EXTRA_TEXT);
        CharSequence title = x.getCharSequence(Notification.EXTRA_TITLE);
        if (!AlertFilter.mightBeMoney(text)) return;
        try {
            JSONObject a = new JSONObject();
            a.put("id", sbn.getKey() + "@" + sbn.getPostTime());
            a.put("app", pkg);
            a.put("title", title == null ? "" : title.toString());
            a.put("text", text.toString());
            a.put("at", sbn.getPostTime());
            a.put("fromSmsApp", AlertFilter.isSmsApp(pkg));
            AlertQueue.add(this, a);
        } catch (JSONException e) {
            return;
        }
        SmsReaderPlugin p = SmsReaderPlugin.live;
        if (p != null) p.alertQueued();
    }
}
