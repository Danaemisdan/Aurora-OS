const { execSync } = require('child_process');
const path = require('path');

exports.default = async function(context) {
    // Only run for Mac
    if (context.electronPlatformName !== 'darwin') return;

    console.log('--- Running custom ad-hoc codesign in afterPack ---');
    const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
    
    try {
        execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
        console.log('--- Successfully ad-hoc signed the app! ---');
    } catch (error) {
        console.error('--- Failed to ad-hoc sign the app ---', error);
    }
};
