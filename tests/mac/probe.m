#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>

// Run in the same WebKit engine as the desktop app without accessing its library.
@interface Probe : NSObject <WKNavigationDelegate>
@property(copy) NSString *checks;
@end
@implementation Probe
- (void)webView:(WKWebView *)web didFinishNavigation:(WKNavigation *)navigation {
    [web callAsyncJavaScript:self.checks arguments:@{} inFrame:nil inContentWorld:WKContentWorld.pageWorld
        completionHandler:^(id result, NSError *error) {
            if (error || ![result isEqual:@"PASS"]) {
                fprintf(stderr, "WebKit reader test failed: %s\n", [(error ?: result) description].UTF8String);
                exit(1);
            }
            puts("PASS — opened sample, bounded viewport, chapter navigation, selection, script isolation, settings");
            exit(0);
        }];
}
@end

int main(int argc, const char **argv) { @autoreleasepool {
    if (argc != 3) return 2;
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    Probe *probe = [Probe new];
    probe.checks = [NSString stringWithContentsOfFile:@(argv[2]) encoding:NSUTF8StringEncoding error:nil];
    if (!probe.checks) return 2;
    WKWebViewConfiguration *config = [WKWebViewConfiguration new];
    config.websiteDataStore = WKWebsiteDataStore.nonPersistentDataStore;
    WKWebView *web = [[WKWebView alloc] initWithFrame:NSMakeRect(0,0,1200,650) configuration:config];
    web.navigationDelegate = probe;
    NSWindow *window = [[NSWindow alloc] initWithContentRect:web.frame styleMask:NSWindowStyleMaskTitled
                                                      backing:NSBackingStoreBuffered defer:NO];
    window.contentView = web;
    [window orderBack:nil];
    // PDF figures can point to publisher CDNs. Keep this regression test offline.
    NSURL *origin = [NSURL URLWithString:@(argv[1])];
    NSURL *temp = [NSURL fileURLWithPath:@(argv[0])].URLByDeletingLastPathComponent;
    WKContentRuleListStore *store = [WKContentRuleListStore storeWithURL:temp];
    NSString *rules = [NSString stringWithFormat:@"[{\"trigger\":{\"url-filter\":\"^https?://\"},\"action\":{\"type\":\"block\"}},"
        "{\"trigger\":{\"url-filter\":\"^http://127[.]0[.]0[.]1:%@/\"},\"action\":{\"type\":\"ignore-previous-rules\"}}]", origin.port];
    [store compileContentRuleListForIdentifier:@"offline-test" encodedContentRuleList:rules
        completionHandler:^(WKContentRuleList *list, NSError *error) {
            if (!list) { fprintf(stderr, "%s\n",error.description.UTF8String); exit(1); }
            [config.userContentController addContentRuleList:list];
            [web loadRequest:[NSURLRequest requestWithURL:origin]];
        }];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 25*NSEC_PER_SEC), dispatch_get_main_queue(), ^{
        fputs("WebKit reader test timed out\n", stderr); exit(1);
    });
    [NSApp run];
    (void)probe.checks;
} return 0; }
