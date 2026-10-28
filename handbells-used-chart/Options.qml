/*
 * The options dialog's root. It uses only controls MuseScore 4.7 loads, and
 * loads the dialog itself from OptionsBody.qml. Some of MuseScore's controls
 * fail to load in an extension, and a body that fails takes nothing else
 * down with it: this file then offers to build or remove the chart from the
 * settings already in Project Properties.
 */

import QtQuick

import MuseApi.Controls
import MuseApi.Interactive
import MuseApi.Log

import "bundle.js" as Lib

ExtensionBlank {
    id: root

    readonly property bool fallingBack: body.status === Loader.Error

    implicitWidth: fallingBack || !body.item ? 520 : body.item.implicitWidth
    implicitHeight: fallingBack || !body.item ? fallback.implicitHeight + 32 : body.item.implicitHeight

    // The middle of an item in screen coordinates. Logged once the dialog is
    // laid out, so the GUI tests can press its buttons.
    function centre(item) {
        var point = item.mapToGlobal(item.width / 2, item.height / 2)
        return { x: point.x, y: point.y }
    }

    // A body that fails to load has already failed by now, before a status
    // handler on the Loader would have been connected to hear it.
    Component.onCompleted: {
        Lib.setup(api, Interactive, Log)
        if (fallingBack) fallbackReady.start()
    }

    Loader {
        id: body
        anchors.fill: parent
        source: "OptionsBody.qml"
    }

    // Placed, not anchored. With anchors.fill on this column, MuseScore 4.7.4
    // segfaults as the dialog opens on a body that failed to load.
    Column {
        id: fallback
        visible: root.fallingBack
        x: 16
        y: 16
        width: 488
        spacing: 12

        StyledTextLabel {
            width: parent.width
            wrapMode: Text.WordWrap
            horizontalAlignment: Text.AlignLeft
            text: "This version of MuseScore cannot show the options dialog. The chart is "
                + "built from the settings in File > Project properties instead."
        }

        Row {
            spacing: 8

            FlatButton {
                id: fallbackBuild
                text: "Build Chart"
                accentButton: true
                onClicked: fallbackStatus.text = Lib.statusOf(Lib.build(Lib.settings()))
            }

            FlatButton {
                id: fallbackRemove
                text: "Remove Chart"
                onClicked: fallbackStatus.text = Lib.remove().summary
            }
        }

        StyledTextLabel {
            id: fallbackStatus
            width: parent.width
            wrapMode: Text.WordWrap
            horizontalAlignment: Text.AlignLeft
        }
    }

    Timer {
        id: fallbackReady
        interval: 1500
        onTriggered: Log.info("Handbells Used Chart options fallback " + JSON.stringify({
            build: root.centre(fallbackBuild),
            remove: root.centre(fallbackRemove)
        }))
    }
}
