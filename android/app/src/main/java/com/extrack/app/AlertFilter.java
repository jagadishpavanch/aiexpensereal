package com.extrack.app;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Pattern;

/** Cheap first filter on the phone. The real reading happens in TypeScript (src/lib/sms). */
final class AlertFilter {
    private AlertFilter() {}

    static final Set<String> SMS_APPS = new HashSet<>(Arrays.asList(
        "com.google.android.apps.messaging", "com.samsung.android.messaging", "com.android.mms", "com.truecaller"));

    private static final Set<String> MONEY_APPS = new HashSet<>(Arrays.asList(
        "com.google.android.apps.nbu.paisa.user", "com.phonepe.app", "net.one97.paytm", "in.org.npci.upiapp", "com.dreamplug.androidapp",
        "com.snapwork.hdfc", "com.csam.icici.bank.imobile", "com.sbi.lotusintouch", "com.axis.mobile", "com.msf.kbank.mobile"));

    private static final Pattern MONEY = Pattern.compile("(?i)(?:rs\\.?|inr|₹)\\s*\\d|\\b(?:debited|credited)\\b");

    static boolean isSmsApp(String pkg) { return SMS_APPS.contains(pkg); }

    static boolean isWatched(String pkg) { return SMS_APPS.contains(pkg) || MONEY_APPS.contains(pkg); }

    static boolean mightBeMoney(CharSequence text) { return text != null && MONEY.matcher(text).find(); }
}
