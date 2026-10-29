//
//  UTSComponent.h
//  DCloudUTSFoundation
//
//  Created by DCloud-iOS-XHY on 2022/12/23.
//

#import <Foundation/Foundation.h>
#import <DCUniBase/DCUniComponent.h>

NS_ASSUME_NONNULL_BEGIN

typedef void (^UTSWatchActionBlock)(id,id);

typedef void (^UTSComponentCallback)(_Nonnull id result, BOOL keepAlive);

typedef CGSize UTSSize;

@interface UTSComponent<T: UIView *> : DCUniComponent

@property(nonatomic, strong, readonly) T __$$el;

- (void)__$$init;
- (void)created;
- (UTSSize)NVMeasure:(UTSSize)size NS_SWIFT_NAME(NVMeasure(size:));
- (void)NVBeforeLoad NS_SWIFT_NAME(NVBeforeLoad());
- (T)NVLoad NS_SWIFT_NAME(NVLoad());
- (void)NVLoaded NS_SWIFT_NAME(NVLoaded());
- (void)onViewLayout NS_SWIFT_NAME(onViewLayout());
- (void)NVLayouted NS_SWIFT_NAME(NVLayouted());
- (void)NVBeforeUnload NS_SWIFT_NAME(NVBeforeUnload());
- (void)NVUnloaded NS_SWIFT_NAME(NVUnloaded());
- (void)NVUpdateStyles:(NSDictionary<NSString *,id> *)styles NS_SWIFT_NAME(NVUpdateStyles(_:));
- (void)unmounted NS_SWIFT_NAME(unmounted());
- (void)__$$emit:(NSString *)name;
- (void)__$$emit:(NSString *)name :(NSDictionary<NSString *,id> * __nullable)data;
- (void)fireEvent:(NSString *)name;
- (void)fireEvent:(NSString *)name :(NSDictionary<NSString *,id> * __nullable)data;
- (void)forceUpdate;
- (void)__$$watch:(NSString *)name :(UTSWatchActionBlock)action;
- (void)__$$watch:(NSString *)name :(UTSWatchActionBlock)action :(NSDictionary<NSString *,id> * __nullable)options;

@end

NS_ASSUME_NONNULL_END
