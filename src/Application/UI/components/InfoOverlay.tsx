import React, { useEffect, useRef, useState } from 'react';
import FreeCamToggle from './FreeCamToggle';
import MuteToggle from './MuteToggle';

interface InfoOverlayProps {
    visible: boolean;
}

const NAME_TEXT = 'Arian Farhadi';
const TITLE_TEXT = 'London, UK';
const HOME_TIME_ZONE = 'Europe/London';
const HOME_LABEL = 'LONDON';
const MULTIPLIER = 1;

// 12-hour clock for a given IANA zone; falls back to the viewer's own zone if
// the browser cannot resolve the requested one.
const formatTime = (timeZone?: string) => {
    const options: Intl.DateTimeFormatOptions = {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
    };
    try {
        return new Date().toLocaleTimeString('en-US', { ...options, timeZone });
    } catch {
        return new Date().toLocaleTimeString('en-US', options);
    }
};

const resolveViewerTimeZone = () => {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch {
        return '';
    }
};

// 'America/New_York' -> 'NEW YORK'
const labelForTimeZone = (timeZone: string) => {
    const city = timeZone.split('/').pop();
    return city ? city.replace(/_/g, ' ').toUpperCase() : 'LOCAL';
};

const VIEWER_TIME_ZONE = resolveViewerTimeZone();
// Only worth a second clock when the viewer is somewhere else.
const SHOW_VIEWER_CLOCK =
    VIEWER_TIME_ZONE !== '' && VIEWER_TIME_ZONE !== HOME_TIME_ZONE;
const VIEWER_LABEL = labelForTimeZone(VIEWER_TIME_ZONE);

const homeLine = () => `${HOME_LABEL} ${formatTime(HOME_TIME_ZONE)}`;
const viewerLine = () => `${VIEWER_LABEL} ${formatTime()}`;

const InfoOverlay: React.FC<InfoOverlayProps> = ({ visible }) => {
    const visRef = useRef(visible);
    const [nameText, setNameText] = useState('');
    const [titleText, setTitleText] = useState('');
    const [homeClock, setHomeClock] = useState(homeLine);
    const [viewerClock, setViewerClock] = useState(viewerLine);
    const homeClockRef = useRef(homeClock);
    const viewerClockRef = useRef(viewerClock);
    const [homeText, setHomeText] = useState('');
    const [viewerText, setViewerText] = useState('');
    const [textDone, setTextDone] = useState(false);
    const [volumeVisible, setVolumeVisible] = useState(false);
    const [freeCamVisible, setFreeCamVisible] = useState(false);

    const typeText = (
        i: number,
        curText: string,
        text: string,
        setText: React.Dispatch<React.SetStateAction<string>>,
        callback: () => void,
        refOverride?: React.MutableRefObject<string>
    ) => {
        if (refOverride) {
            text = refOverride.current;
        }
        if (i < text.length) {
            setTimeout(() => {
                if (visRef.current === true)
                    window.postMessage(
                        { type: 'keydown', key: `_AUTO_${text[i]}` },
                        '*'
                    );

                setText(curText + text[i]);
                typeText(
                    i + 1,
                    curText + text[i],
                    text,
                    setText,
                    callback,
                    refOverride
                );
            }, Math.random() * 50 + 50 * MULTIPLIER);
        } else {
            callback();
        }
    };

    useEffect(() => {
        if (visible && nameText == '') {
            setTimeout(() => {
                typeText(0, '', NAME_TEXT, setNameText, () => {
                    typeText(0, '', TITLE_TEXT, setTitleText, () => {
                        typeText(
                            0,
                            '',
                            homeClock,
                            setHomeText,
                            () => {
                                if (!SHOW_VIEWER_CLOCK) {
                                    setTextDone(true);
                                    return;
                                }
                                typeText(
                                    0,
                                    '',
                                    viewerClock,
                                    setViewerText,
                                    () => {
                                        setTextDone(true);
                                    },
                                    viewerClockRef
                                );
                            },
                            homeClockRef
                        );
                    });
                });
            }, 400);
        }
        visRef.current = visible;
    }, [visible]);

    useEffect(() => {
        if (textDone) {
            setTimeout(() => {
                setVolumeVisible(true);
                setTimeout(() => {
                    setFreeCamVisible(true);
                }, 250);
            }, 250);
        }
    }, [textDone]);

    useEffect(() => {
        window.postMessage({ type: 'keydown', key: `_AUTO_` }, '*');
    }, [freeCamVisible, volumeVisible]);

    useEffect(() => {
        const interval = setInterval(() => {
            setHomeClock(homeLine());
            setViewerClock(viewerLine());
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        homeClockRef.current = homeClock;
        textDone && setHomeText(homeClock);
    }, [homeClock]);

    useEffect(() => {
        viewerClockRef.current = viewerClock;
        textDone && SHOW_VIEWER_CLOCK && setViewerText(viewerClock);
    }, [viewerClock]);

    // The bottom clock shares its row with the toggles; when the viewer is in
    // London there is only one clock, so it takes that row itself.
    const lastClockText = SHOW_VIEWER_CLOCK ? viewerText : homeText;

    return (
        <div style={styles.wrapper}>
            {nameText !== '' && (
                <div style={styles.container}>
                    <p>{nameText}</p>
                </div>
            )}
            {titleText !== '' && (
                <div style={styles.container}>
                    <p>{titleText}</p>
                </div>
            )}
            {SHOW_VIEWER_CLOCK && homeText !== '' && (
                <div style={styles.container}>
                    <p>{homeText}</p>
                </div>
            )}
            {lastClockText !== '' && (
                <div style={styles.lastRow}>
                    <div
                        style={Object.assign(
                            {},
                            styles.container,
                            styles.lastRowChild
                        )}
                    >
                        <p>{lastClockText}</p>
                    </div>
                    {volumeVisible && (
                        <div style={styles.lastRowChild}>
                            <MuteToggle />
                        </div>
                    )}
                    {freeCamVisible && (
                        <div style={styles.lastRowChild}>
                            <FreeCamToggle />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const styles: StyleSheetCSS = {
    container: {
        background: 'black',
        padding: 4,
        paddingLeft: 16,
        paddingRight: 16,
        textAlign: 'center',
        display: 'flex',
        marginBottom: 4,
        boxSizing: 'border-box',
        whiteSpace: 'nowrap',
        flexShrink: 0,
    },
    wrapper: {
        position: 'absolute',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
    },
    blinkingContainer: {
        // width: 100,
        // height: 100,
        marginLeft: 8,
        paddingBottom: 2,
        paddingRight: 4,
    },
    lastRow: {
        display: 'flex',
        flexDirection: 'row',
    },
    lastRowChild: {
        marginRight: 4,
    },
};

export default InfoOverlay;
