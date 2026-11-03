#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

static NSString *const origin = @"http://127.0.0.1:5173";
@interface Reader : NSObject <NSApplicationDelegate,WKNavigationDelegate,WKUIDelegate,WKDownloadDelegate,NSToolbarDelegate,WKScriptMessageHandler>
@property NSWindow *window;
@property WKWebView *view;
@property NSTask *service;
@property NSPipe *lifetime;
@property NSString *root;
@property BOOL quitting;
@end

@implementation Reader
- (void)fail:(NSString *)message {
    NSAlert *alert = [NSAlert new];
    alert.messageText = @"笺读"; alert.informativeText = message;
    [alert runModal]; [NSApp terminate:nil];
}
- (void)menu:(NSString *)name entries:(NSArray *)entries {
    NSMenu *menu = [[NSMenu alloc] initWithTitle:name];
    NSMenuItem *item = [NSApp.mainMenu addItemWithTitle:name action:nil keyEquivalent:@""];
    item.submenu = menu;
    for (NSArray *entry in entries)
        [menu addItemWithTitle:entry[0] action:NSSelectorFromString(entry[1]) keyEquivalent:entry[2]];
}
- (NSArray *)toolbarDefaultItemIdentifiers:(NSToolbar *)toolbar {
    return @[@"sidebar", NSToolbarFlexibleSpaceItemIdentifier, @"import", @"settings"];
}
- (NSArray *)toolbarAllowedItemIdentifiers:(NSToolbar *)toolbar {
    return [self toolbarDefaultItemIdentifiers:toolbar];
}
- (NSToolbarItem *)toolbar:(NSToolbar *)toolbar itemForItemIdentifier:(NSString *)identifier willBeInsertedIntoToolbar:(BOOL)insert {
    NSDictionary *commands = @{@"sidebar": @[@"侧栏", @"sidebar.left"], @"import": @[@"导入论文", @"plus"], @"settings": @[@"翻译设置", @"slider.horizontal.3"]};
    NSArray *command = commands[identifier];
    if (!command) return nil;
    NSToolbarItem *item = [[NSToolbarItem alloc] initWithItemIdentifier:identifier];
    item.label = command[0]; item.toolTip = command[0];
    item.image = [NSImage imageWithSystemSymbolName:command[1] accessibilityDescription:command[0]];
    item.target = self; item.action = @selector(performReaderCommand:);
    return item;
}
- (void)performReaderCommand:(NSToolbarItem *)item {
    if ([item.itemIdentifier isEqual:@"settings"]) [self openSettings:item];
    if ([item.itemIdentifier isEqual:@"import"]) [self openImport:item];
    if ([item.itemIdentifier isEqual:@"sidebar"]) [self toggleSidebar:item];
}
- (void)performReaderAction:(NSString *)script {
    NSString *action = [NSString stringWithFormat:@"if (!document.querySelector('dialog[open]')) { %@ }", script];
    [self.window makeFirstResponder:self.view];
    [self.view evaluateJavaScript:action completionHandler:nil];
}
- (void)openSettings:(id)sender {
    [self performReaderAction:@"document.querySelector('.settings-button')?.click()"];
}
- (void)toggleSidebar:(id)sender {
    [self performReaderAction:@"document.getElementById('sidebar-toggle')?.click()"];
}
- (void)openImport:(id)sender {
    [self performReaderAction:@"const input = document.getElementById('arxiv-input');"
        "if (input) input.focus(); else document.querySelector('.open-import')?.click();"];
}
- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
    if (!message.frameInfo.mainFrame || ![message.frameInfo.securityOrigin.host isEqual:@"127.0.0.1"]) return;
    self.window.appearance = [NSAppearance appearanceNamed:[message.body isEqual:@"dark"] ? NSAppearanceNameDarkAqua : NSAppearanceNameAqua];
}
// WebKit scopes its default store to the application identifier. Upgrade the
// preview build before creating a WKWebView, so books and settings move together.
- (BOOL)prepareReadingStore {
    NSFileManager *files = NSFileManager.defaultManager;
    NSURL *library = [files URLsForDirectory:NSLibraryDirectory inDomains:NSUserDomainMask].firstObject;
    NSURL *webkit = [library URLByAppendingPathComponent:@"WebKit" isDirectory:YES];
    NSString *previewID = @"com.baigeiww.jiandu-reader.webkit";
    NSURL *source = [[webkit URLByAppendingPathComponent:previewID] URLByAppendingPathComponent:@"WebsiteData"];
    NSURL *directory = [webkit URLByAppendingPathComponent:NSBundle.mainBundle.bundleIdentifier];
    NSURL *dest = [directory URLByAppendingPathComponent:@"WebsiteData"];
    if ([files fileExistsAtPath:dest.path] || ![files fileExistsAtPath:source.path]) return YES;
    if ([NSRunningApplication runningApplicationsWithBundleIdentifier:previewID].count) {
        [self fail:@"请先退出已打开的预览版笺读，然后重新打开新版以迁移阅读资料。"]; return NO;
    }
    NSError *error = nil;
    NSURL *staging = [directory URLByAppendingPathComponent:NSUUID.UUID.UUIDString];
    if ([files createDirectoryAtURL:directory withIntermediateDirectories:YES attributes:nil error:&error] &&
        [files copyItemAtURL:source toURL:staging error:&error] &&
        [files moveItemAtURL:staging toURL:dest error:&error]) return YES;
    [files removeItemAtURL:staging error:nil];
    [self fail:[@"迁移阅读资料失败，旧资料已保留。 " stringByAppendingString:error.localizedDescription]];
    return NO;
}
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    NSApp.mainMenu = [NSMenu new];
    [self menu:@"笺读" entries:@[@[@"翻译设置…",@"openSettings:",@","],@[@"隐藏笺读",@"hide:",@"h"],@[@"退出笺读",@"terminate:",@"q"]]];
    [self menu:@"文件" entries:@[@[@"导入论文…",@"openImport:",@"o"]]];
    [self menu:@"编辑" entries:@[@[@"撤销",@"undo:",@"z"],@[@"重做",@"redo:",@"Z"],@[@"剪切",@"cut:",@"x"],@[@"复制",@"copy:",@"c"],@[@"粘贴",@"paste:",@"v"],@[@"全选",@"selectAll:",@"a"]]];
    [self menu:@"显示" entries:@[@[@"刷新",@"refresh:",@"r"],@[@"放大",@"larger:",@"="],@[@"缩小",@"smaller:",@"-"],@[@"实际大小",@"actual:",@"0"],@[@"全屏",@"toggleFullScreen:",@""]]];
    NSMenu *viewMenu = [NSApp.mainMenu itemWithTitle:@"显示"].submenu;
    NSMenuItem *sidebarItem = [viewMenu insertItemWithTitle:@"切换侧栏" action:@selector(toggleSidebar:) keyEquivalent:@"s" atIndex:0];
    sidebarItem.target = self;
    sidebarItem.keyEquivalentModifierMask = NSEventModifierFlagControl | NSEventModifierFlagCommand;
    [self menu:@"窗口" entries:@[@[@"最小化",@"performMiniaturize:",@"m"],@[@"关闭",@"performClose:",@"w"]]];
    self.root = NSBundle.mainBundle.bundlePath.stringByDeletingLastPathComponent;
    if (![self prepareReadingStore]) return;
    WKWebViewConfiguration *config = [WKWebViewConfiguration new];
    [config.userContentController addScriptMessageHandler:self name:@"readerAppearance"];
    WKUserScript *shell = [[WKUserScript alloc] initWithSource:@"document.documentElement.dataset.nativeShell='true'" injectionTime:WKUserScriptInjectionTimeAtDocumentEnd forMainFrameOnly:YES];
    [config.userContentController addUserScript:shell];
    self.view = [[WKWebView alloc] initWithFrame:NSZeroRect configuration:config];
    self.view.navigationDelegate = self; self.view.UIDelegate = self;
    self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,1320,840)
        styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable|NSWindowStyleMaskResizable
        backing:NSBackingStoreBuffered defer:NO];
    self.window.title = @"笺读"; self.window.minSize = NSMakeSize(780,600);
    NSToolbar *toolbar = [[NSToolbar alloc] initWithIdentifier:@"ReaderToolbar"];
    toolbar.delegate = self;
    toolbar.displayMode = NSToolbarDisplayModeIconOnly;
    self.window.toolbarStyle = NSWindowToolbarStyleUnifiedCompact;
    self.window.toolbar = toolbar;
    self.window.contentView = self.view; self.window.releasedWhenClosed = NO;
    [self.window center]; [self.window setFrameAutosaveName:@"ReaderWindow"];
    [self.window makeKeyAndOrderFront:nil]; [NSApp activateIgnoringOtherApps:YES];
    NSString *resources = NSBundle.mainBundle.resourcePath;
    self.service = [NSTask new]; self.lifetime = [NSPipe pipe];
    self.service.executableURL = [NSURL fileURLWithPath:[resources stringByAppendingPathComponent:@"node"]];
    self.service.arguments = @[[resources stringByAppendingPathComponent:@"service.cjs"]];
    self.service.currentDirectoryURL = [NSURL fileURLWithPath:self.root];
    self.service.standardInput = self.lifetime;
    NSPipe *output = [NSPipe pipe]; self.service.standardOutput = output;
    __weak Reader *owner = self;
    self.service.terminationHandler = ^(NSTask *task) {
        dispatch_async(dispatch_get_main_queue(), ^{
            if (!owner.quitting) [owner fail:@"阅读服务已停止。请确认旧版笺读和端口 5173 上的其他服务已退出，再重新打开。"];
        });
    };
    NSError *error;
    if (![self.service launchAndReturnError:&error]) { [self fail:error.localizedDescription]; return; }
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED,0), ^{
        NSData *signal = [output.fileHandleForReading availableData];
        if (![[[NSString alloc] initWithData:signal encoding:NSUTF8StringEncoding] hasPrefix:@"READY"]) return;
        dispatch_async(dispatch_get_main_queue(), ^{
            NSString *route = [[NSFileManager defaultManager] fileExistsAtPath:self.snapshot] ? @"/__reader/health" : @"/";
            [self.view loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:[origin stringByAppendingString:route]]]];
        });
    });
}
- (NSString *)snapshot { return [self.root stringByAppendingPathComponent:@".runtime/native-migration.json"]; }
- (void)webView:(WKWebView *)web didFinishNavigation:(WKNavigation *)nav {
    if ([web.URL.path isEqual:@"/"] && [NSProcessInfo.processInfo.arguments containsObject:@"--check-reader"]) {
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 4*NSEC_PER_SEC), dispatch_get_main_queue(), ^{
            NSString *check = @"const d=document.querySelector('iframe')?.contentDocument;"
                "return {blocks:d?.querySelectorAll('[data-translate]').length||0,"
                "translations:d?.querySelectorAll('.reader-translation').length||0,"
                "formulas:d?.querySelectorAll('math[role=button]').length||0,"
                "deepseek:(await (await fetch('/local-reader-config')).json()).enabled===true,"
                "migration:JSON.parse(localStorage.getItem('reader-import-report')||'null')}";
            [web callAsyncJavaScript:check arguments:@{} inFrame:nil inContentWorld:WKContentWorld.pageWorld
                completionHandler:^(id report,NSError *error) {
                    if (!report || error) return;
                    NSData *json = [NSJSONSerialization dataWithJSONObject:report options:0 error:nil];
                    [json writeToFile:[self.root stringByAppendingPathComponent:@"output/native-check.json"] atomically:YES];
                }];
        });
    }
    if (![web.URL.absoluteString isEqual:[origin stringByAppendingString:@"/__reader/health"]]) return;
    NSData *data = [NSData dataWithContentsOfFile:self.snapshot];
    id backup = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
    NSString *script = [NSString stringWithContentsOfFile:[NSBundle.mainBundle pathForResource:@"transfer" ofType:@"js"] encoding:NSUTF8StringEncoding error:nil];
    if (!backup || !script) { [self fail:@"迁移文件读取失败，旧版资料仍在。"]; return; }
    [web callAsyncJavaScript:[script stringByAppendingString:@";return await ReaderTransfer.importBackup(snapshot,localStorage)"]
        arguments:@{@"snapshot":backup} inFrame:nil inContentWorld:WKContentWorld.pageWorld
        completionHandler:^(id report,NSError *error) {
            if (error) { [self fail:@"迁移核对失败，已保留原始资料和迁移文件。"]; return; }
            if (![[NSFileManager defaultManager] removeItemAtPath:self.snapshot error:nil]) { [self fail:@"导入成功，但无法清理一次性迁移文件。"]; return; }
            [web loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:origin]]];
        }];
}
- (void)refresh:(id)sender { [self.view reload]; }
- (void)larger:(id)sender { self.view.pageZoom = MIN(3,self.view.pageZoom+0.1); }
- (void)smaller:(id)sender { self.view.pageZoom = MAX(0.5,self.view.pageZoom-0.1); }
- (void)actual:(id)sender { self.view.pageZoom = 1; }
- (void)webViewWebContentProcessDidTerminate:(WKWebView *)web { [web reload]; }
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)app { return YES; }
- (void)applicationWillTerminate:(NSNotification *)notification {
    self.quitting = YES; [self.lifetime.fileHandleForWriting closeFile];
    if (self.service.running) [self.service terminate];
}
- (void)webView:(WKWebView *)web decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))decide {
    NSURL *url = action.request.URL;
    BOOL local = [url.scheme isEqual:@"http"] && [url.host isEqual:@"127.0.0.1"] && url.port.integerValue==5173;
    if (action.shouldPerformDownload && [url.absoluteString hasPrefix:[@"blob:" stringByAppendingString:[origin stringByAppendingString:@"/"]]]) {
        decide(WKNavigationActionPolicyDownload); return;
    }
    if ((local && action.targetFrame) || ([url.scheme isEqual:@"about"] && action.targetFrame && !action.targetFrame.mainFrame)) {
        decide(WKNavigationActionPolicyAllow); return;
    }
    if ((action.navigationType==WKNavigationTypeLinkActivated || !action.targetFrame) &&
        [@[@"http",@"https"] containsObject:url.scheme] && !url.user && !url.password) [NSWorkspace.sharedWorkspace openURL:url];
    decide(WKNavigationActionPolicyCancel);
}
- (void)webView:(WKWebView *)web navigationAction:(WKNavigationAction *)action didBecomeDownload:(WKDownload *)download { download.delegate = self; }
- (void)download:(WKDownload *)download decideDestinationUsingResponse:(NSURLResponse *)response suggestedFilename:(NSString *)name completionHandler:(void (^)(NSURL *))complete {
    NSSavePanel *panel = [NSSavePanel savePanel]; panel.nameFieldStringValue = name;
    [panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse result) { complete(result==NSModalResponseOK ? panel.URL : nil); }];
}
- (void)webView:(WKWebView *)web runOpenPanelWithParameters:(WKOpenPanelParameters *)params initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(NSArray<NSURL *> *))complete {
    NSOpenPanel *panel = [NSOpenPanel openPanel]; panel.allowsMultipleSelection = params.allowsMultipleSelection;
    [panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse result) { complete(result==NSModalResponseOK ? panel.URLs : nil); }];
}
@end
int main(void) { @autoreleasepool {
    NSApplication *app = NSApplication.sharedApplication;
    Reader *reader = [Reader new]; app.delegate = reader;
    [app setActivationPolicy:NSApplicationActivationPolicyRegular]; [app run];
    (void)reader.window;
} return 0; }
