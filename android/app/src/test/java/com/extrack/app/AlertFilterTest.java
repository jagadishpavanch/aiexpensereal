package com.extrack.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class AlertFilterTest {
    @Test
    public void keepsMoneyText() {
        assertTrue(AlertFilter.mightBeMoney("Sent Rs.250.00 From HDFC Bank"));
        assertTrue(AlertFilter.mightBeMoney("INR 3,499.00 spent on card"));
        assertTrue(AlertFilter.mightBeMoney("₹120 paid to Ramesh"));
        assertTrue(AlertFilter.mightBeMoney("A/C X4821 debited by 500.0"));
    }

    @Test
    public void dropsOtherText() {
        assertFalse(AlertFilter.mightBeMoney("Dinner at 8? Bring curd."));
        assertFalse(AlertFilter.mightBeMoney("Your order has shipped"));
    }

    @Test
    public void watchesOnlyListedApps() {
        assertTrue(AlertFilter.isWatched("com.phonepe.app"));
        assertTrue(AlertFilter.isWatched("com.google.android.apps.messaging"));
        assertFalse(AlertFilter.isWatched("com.whatsapp"));
        assertTrue(AlertFilter.isSmsApp("com.samsung.android.messaging"));
        assertFalse(AlertFilter.isSmsApp("com.phonepe.app"));
    }
}
