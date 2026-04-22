package swiss.dfx.bitcoin

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactNativeHost
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost
import com.facebook.react.modules.i18nmanager.I18nUtil

class MainApplication : Application(), ReactApplication {

    override val reactNativeHost: ReactNativeHost by lazy {
        object : DefaultReactNativeHost(this) {
            override fun getPackages() =
                PackageList(this).packages.apply {
                    // Packages that cannot be autolinked yet can be added manually here, for example:
                    // add(MyReactNativePackage())
                }

            override fun getUseDeveloperSupport() = BuildConfig.DEBUG

            override fun getJSMainModuleName() = "index"
        }
    }

    override val reactHost: ReactHost by lazy {
        getDefaultReactHost(applicationContext, reactNativeHost)
    }

    override fun onCreate() {
        super.onCreate()
        val sharedI18nUtilInstance = I18nUtil.getInstance()
        sharedI18nUtilInstance.allowRTL(applicationContext, true)
        loadReactNative(this)
    }
}
