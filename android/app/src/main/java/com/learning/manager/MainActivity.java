package com.learning.manager;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(StudyTimerPlugin.class);
        registerPlugin(UsageStatsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
