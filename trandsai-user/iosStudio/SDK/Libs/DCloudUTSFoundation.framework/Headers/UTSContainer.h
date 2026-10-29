//
//  UTSContainer.h
//  DCloudUTSFoundation
//
//  Created by DCloud-iOS-XHY on 2023/1/16.
//

#import <DCloudUTSFoundation/DCloudUTSFoundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface UTSContainer<T: UIView*> : UTSComponent

@property(nonatomic, strong, readonly) T __$$el;
- (T)NVLoad NS_SWIFT_NAME(NVLoad());

@end

NS_ASSUME_NONNULL_END
