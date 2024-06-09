import "keycloakify/tools/Object.fromEntries";
import { useEffect, useState } from "react";
import { assert } from "tsafe/assert";
import messages_fallbackLanguage from "./baseMessages/en";
import { getMessages } from "./baseMessages";
import type { KcContext } from "../KcContext";
import { Reflect } from "tsafe/Reflect";

export const fallbackLanguageTag = "en";

export type KcContextLike = {
    locale?: {
        currentLanguageTag: string;
        supported: { languageTag: string; url: string; label: string }[];
    };
};

assert<KcContext extends KcContextLike ? true : false>();

export type MessageKey = keyof typeof messages_fallbackLanguage;

export type GenericI18n<MessageKey extends string> = {
    /**
     * e.g: "en", "fr", "zh-CN"
     *
     * The current language
     */
    currentLanguageTag: string;
    /**
     * Redirect to this url to change the language.
     * After reload currentLanguageTag === newLanguageTag
     */
    getChangeLocalUrl: (newLanguageTag: string) => string;
    /**
     * e.g. "en" => "English", "fr" => "Français", ...
     *
     * Used to render a select that enable user to switch language.
     * ex: https://user-images.githubusercontent.com/6702424/186044799-38801eec-4e89-483b-81dd-8e9233e8c0eb.png
     * */
    labelBySupportedLanguageTag: Record<string, string>;
    /**
     * Examples assuming currentLanguageTag === "en"
     *
     * msg("access-denied") === <span>Access denied</span>
     * msg("impersonateTitleHtml", "Foo") === <span><strong>Foo</strong> Impersonate User</span>
     */
    msg: (key: MessageKey, ...args: (string | undefined)[]) => JSX.Element;
    /**
     * It's the same thing as msg() but instead of returning a JSX.Element it returns a string.
     * It can be more convenient to manipulate strings but if there are HTML tags it wont render.
     * msgStr("impersonateTitleHtml", "Foo") === "<strong>Foo</strong> Impersonate User"
     */
    msgStr: (key: MessageKey, ...args: (string | undefined)[]) => string;
    /**
     * This is meant to be used when the key argument is variable, something that might have been configured by the user
     * in the Keycloak admin for example.
     *
     * Examples assuming currentLanguageTag === "en"
     * {
     *   en: {
     *     "access-denied": "Access denied",
     *     "foo": "Foo {0} {1}",
     *     "bar": "Bar {0}"
     *   }
     * }
     *
     * advancedMsg("${access-denied} foo bar") === <span>{msgStr("access-denied")} foo bar<span> === <span>Access denied foo bar</span>
     * advancedMsg("${access-denied}") === advancedMsg("access-denied") === msg("access-denied") === <span>Access denied</span>
     * advancedMsg("${not-a-message-key}") === advancedMsg(not-a-message-key") === <span>not-a-message-key</span>
     * advancedMsg("${bar}", "<strong>c</strong>")
     *    === <span>{msgStr("bar", "<strong>XXX</strong>")}<span>
     *    === <span>Bar &lt;strong&gt;XXX&lt;/strong&gt;</span> (The html in the arg is partially escaped for security reasons, it might be untrusted)
     * advancedMsg("${foo} xx ${bar}", "a", "b", "c")
     *    === <span>{msgStr("foo", "a", "b")} xx {msgStr("bar")}<span>
     *    === <span>Foo a b xx Bar {0}</span> (The substitution are only applied in the first message)
     */
    advancedMsg: (key: string, ...args: (string | undefined)[]) => JSX.Element;
    /**
     * See advancedMsg() but instead of returning a JSX.Element it returns a string.
     */
    advancedMsgStr: (key: string, ...args: (string | undefined)[]) => string;

    /**
     * Initially the messages are in english (fallback language).
     * The translations in the current language are being fetched dynamically.
     * This property is true while the translations are being fetched.
     */
    isFetchingTranslations: boolean;
};

function createGetI18n<ExtraMessageKey extends string = never>(extraMessages: { [languageTag: string]: { [key in ExtraMessageKey]: string } }) {
    type I18n = GenericI18n<MessageKey | ExtraMessageKey>;

    type Result = { i18n: I18n; prI18n_currentLanguage: Promise<I18n> | undefined };

    const cachedResultByKcContext = new WeakMap<KcContextLike, Result>();

    function getI18n(params: { kcContext: KcContextLike }): Result {
        const { kcContext } = params;

        use_cache: {
            const cachedResult = cachedResultByKcContext.get(kcContext);

            if (cachedResult === undefined) {
                break use_cache;
            }

            return cachedResult;
        }

        const partialI18n: Pick<I18n, "currentLanguageTag" | "getChangeLocalUrl" | "labelBySupportedLanguageTag"> = {
            currentLanguageTag: kcContext.locale?.currentLanguageTag ?? fallbackLanguageTag,
            getChangeLocalUrl: newLanguageTag => {
                const { locale } = kcContext;

                assert(locale !== undefined, "Internationalization not enabled");

                const targetSupportedLocale = locale.supported.find(({ languageTag }) => languageTag === newLanguageTag);

                assert(targetSupportedLocale !== undefined, `${newLanguageTag} need to be enabled in Keycloak admin`);

                return targetSupportedLocale.url;
            },
            labelBySupportedLanguageTag: Object.fromEntries((kcContext.locale?.supported ?? []).map(({ languageTag, label }) => [languageTag, label]))
        };

        const { createI18nTranslationFunctions } = createI18nTranslationFunctionsFactory<MessageKey, ExtraMessageKey>({
            messages_fallbackLanguage,
            extraMessages_fallbackLanguage: extraMessages[fallbackLanguageTag],
            extraMessages: extraMessages[partialI18n.currentLanguageTag]
        });

        const isCurrentLanguageFallbackLanguage = partialI18n.currentLanguageTag === fallbackLanguageTag;

        const result: Result = {
            i18n: {
                ...partialI18n,
                ...createI18nTranslationFunctions({ messages: undefined }),
                isFetchingTranslations: !isCurrentLanguageFallbackLanguage
            },
            prI18n_currentLanguage: isCurrentLanguageFallbackLanguage
                ? undefined
                : (async () => {
                      const messages = await getMessages(partialI18n.currentLanguageTag);

                      const i18n_currentLanguage: I18n = {
                          ...partialI18n,
                          ...createI18nTranslationFunctions({ messages }),
                          isFetchingTranslations: false
                      };

                      // NOTE: This promise.resolve is just because without it we TypeScript
                      // gives a Variable 'result' is used before being assigned. error
                      await Promise.resolve().then(() => {
                          result.i18n = i18n_currentLanguage;
                          result.prI18n_currentLanguage = undefined;
                      });

                      return i18n_currentLanguage;
                  })()
        };

        cachedResultByKcContext.set(kcContext, result);

        return result;
    }

    return { getI18n };
}

export function createUseI18n<ExtraMessageKey extends string = never>(extraMessages: {
    [languageTag: string]: { [key in ExtraMessageKey]: string };
}) {
    type I18n = GenericI18n<MessageKey | ExtraMessageKey>;

    const { getI18n } = createGetI18n(extraMessages);

    function useI18n(params: { kcContext: KcContextLike }): { i18n: I18n } {
        const { kcContext } = params;

        const { i18n, prI18n_currentLanguage } = getI18n({ kcContext });

        const [i18n_toReturn, setI18n_toReturn] = useState<I18n>(i18n);

        useEffect(() => {
            let isActive = true;

            prI18n_currentLanguage?.then(i18n => {
                if (!isActive) {
                    return;
                }

                setI18n_toReturn(i18n);
            });

            return () => {
                isActive = false;
            };
        }, []);

        return { i18n: i18n_toReturn };
    }

    return { useI18n, ofTypeI18n: Reflect<I18n>() };
}

function createI18nTranslationFunctionsFactory<MessageKey extends string, ExtraMessageKey extends string>(params: {
    messages_fallbackLanguage: Record<MessageKey, string>;
    extraMessages_fallbackLanguage: Record<ExtraMessageKey, string> | undefined;
    extraMessages: Partial<Record<ExtraMessageKey, string>> | undefined;
}) {
    const { extraMessages } = params;

    const messages_fallbackLanguage = {
        ...params.messages_fallbackLanguage,
        ...params.extraMessages_fallbackLanguage
    };

    function createI18nTranslationFunctions(params: {
        messages: Partial<Record<MessageKey, string>> | undefined;
    }): Pick<GenericI18n<MessageKey | ExtraMessageKey>, "msg" | "msgStr" | "advancedMsg" | "advancedMsgStr"> {
        const messages = {
            ...params.messages,
            ...extraMessages
        };

        function resolveMsg(props: { key: string; args: (string | undefined)[]; doRenderAsHtml: boolean }): string | JSX.Element | undefined {
            const { key, args, doRenderAsHtml } = props;

            const messageOrUndefined: string | undefined = (messages as any)[key] ?? (messages_fallbackLanguage as any)[key];

            if (messageOrUndefined === undefined) {
                return undefined;
            }

            const message = messageOrUndefined;

            const messageWithArgsInjectedIfAny = (() => {
                const startIndex = message
                    .match(/{[0-9]+}/g)
                    ?.map(g => g.match(/{([0-9]+)}/)![1])
                    .map(indexStr => parseInt(indexStr))
                    .sort((a, b) => a - b)[0];

                if (startIndex === undefined) {
                    // No {0} in message (no arguments expected)
                    return message;
                }

                let messageWithArgsInjected = message;

                args.forEach((arg, i) => {
                    if (arg === undefined) {
                        return;
                    }

                    messageWithArgsInjected = messageWithArgsInjected.replace(
                        new RegExp(`\\{${i + startIndex}\\}`, "g"),
                        arg.replace(/</g, "&lt;").replace(/>/g, "&gt;")
                    );
                });

                return messageWithArgsInjected;
            })();

            return doRenderAsHtml ? (
                <span
                    // NOTE: The message is trusted. The arguments are not but are escaped.
                    dangerouslySetInnerHTML={{
                        __html: messageWithArgsInjectedIfAny
                    }}
                />
            ) : (
                messageWithArgsInjectedIfAny
            );
        }

        function resolveMsgAdvanced(props: { key: string; args: (string | undefined)[]; doRenderAsHtml: boolean }): JSX.Element | string {
            const { key, args, doRenderAsHtml } = props;

            if (!/\$\{[^}]+\}/.test(key)) {
                const resolvedMessage = resolveMsg({ key, args, doRenderAsHtml });

                if (resolvedMessage === undefined) {
                    return doRenderAsHtml ? <span dangerouslySetInnerHTML={{ __html: key }} /> : key;
                }

                return resolvedMessage;
            }

            let isFirstMatch = true;

            const resolvedComplexMessage = key.replace(/\$\{([^}]+)\}/g, (...[, key_i]) => {
                const replaceBy = resolveMsg({ key: key_i, args: isFirstMatch ? args : [], doRenderAsHtml: false }) ?? key_i;

                isFirstMatch = false;

                return replaceBy;
            });

            return doRenderAsHtml ? <span dangerouslySetInnerHTML={{ __html: resolvedComplexMessage }} /> : resolvedComplexMessage;
        }

        return {
            msgStr: (key, ...args) => resolveMsg({ key, args, doRenderAsHtml: false }) as string,
            msg: (key, ...args) => resolveMsg({ key, args, doRenderAsHtml: true }) as JSX.Element,
            advancedMsg: (key, ...args) =>
                resolveMsgAdvanced({
                    key,
                    args,
                    doRenderAsHtml: true
                }) as JSX.Element,
            advancedMsgStr: (key, ...args) =>
                resolveMsgAdvanced({
                    key,
                    args,
                    doRenderAsHtml: false
                }) as string
        };
    }

    return { createI18nTranslationFunctions };
}
