package swiss.dfx.bitcoin

import android.content.pm.ActivityInfo
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.swmansion.rnscreens.fragment.restoration.RNScreensFragmentFactory

class MainActivity : ReactActivity() {

    override fun getMainComponentName(): String = "BlueWallet"

    override fun onCreate(savedInstanceState: Bundle?) {
        // react-native-screens override
        supportFragmentManager.fragmentFactory = RNScreensFragmentFactory()
        super.onCreate(null)
        if (resources.getBoolean(R.bool.portrait_only)) {
            requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        }
    }

    override fun createReactActivityDelegate(): ReactActivityDelegate =
        DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
