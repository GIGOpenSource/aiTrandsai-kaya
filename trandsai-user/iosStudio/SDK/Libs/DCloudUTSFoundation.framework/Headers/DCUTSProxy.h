//
//  DCUTSProxy.h
//  libWeex
//
//  Created by Dcloud-XHY on 2022/8/16.
//  Copyright © 2022 DCloud. All rights reserved.
//

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <DCloudUTSFoundation/DCUniModel.h>
#import <JavaScriptCore/JavaScriptCore.h>

@class UTSCallback;
@class PTDeviceInfo;

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger,DCUTSBlockType){
    DCUTSBlockTypeParams,
    DCUTSBlockTypeReturn,
    DCUTSBlockTypeError
};

typedef void (^DCUTSBlock)(id result, DCUTSBlockType type);

extern NSString *const kUTSCallbackId;
extern NSString *const kUTSWXCallback;
extern NSString *const kUTSWXCallbackName;

@interface DCUTSProxy : NSObject

+ (UTSCallback *)getUTSCallBackWithId:(NSInteger)callbackId keepAlive:(BOOL)keepAlive;
+ (NSInvocation *)invocationWithTarget:(id)target
                              selector:(SEL)selector
                             arguments:(NSArray *)params
                         argumentsType:(NSArray *)paramsType
                             keepAlive:(BOOL)keepAlive
                                nested:(BOOL)nested
                              callback:(DCUTSBlock)cb;

+ (id)switchInvocationReture:(NSInvocation *)invocation;
+ (BOOL)isBaseObject:(id)obj;
+ (NSString *)utsJsonObjectToString:(id)obj;
+ (BOOL)isClassKindOfUTSJSONObject:(Class)aClass;
+ (NSString *)originTypeFromNumber:(NSNumber *)data;
+ (PTDeviceInfo *)deviceInfo;
+ (void)commitLogMessage:(NSString *)msg flag:(NSString *)flag;
+ (BOOL)conformsToJSExport:(id)obj;
+ (JSContext *)getCurrentJSContext;
@end

NS_ASSUME_NONNULL_END
