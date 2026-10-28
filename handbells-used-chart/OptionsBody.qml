/*
 * The options dialog. It opens on the settings stored in the score and saves
 * the ones it changes back there before building, so the menu entry that
 * runs from Project Properties draws the same chart afterwards.
 *
 * Only controls MuseScore 4.7 loads in an extension are used here. Its own
 * dropdown and check box are not among them, so dropdowns are Qt's ComboBox
 * and switches are ToggleButtons.
 */

import QtQuick
import QtQuick.Controls as QQC

import MuseApi.Controls
import MuseApi.Interactive
import MuseApi.Log

import "bundle.js" as Lib

Item {
    id: body

    property var options: ({})
    property var lists: ({ naturalNotes: [], shapes: [], modes: [] })
    property var instruments: []
    property var facts: ({ parts: [], heads: [] })
    // How many instruments are ticked. Separate charts need two.
    property int ticked: 0
    // Why the score could not be read as the dialog opened, shown in place of
    // the controls.
    property string failure: ""

    // The kinds the chart tells apart, a row of the dialog each. key is the
    // prefix of the row's settings: bellHead, bellShape, bellLabel and, on a
    // row with a colour, bellColor.
    readonly property var kindList: [
        { key: "bell", name: "Handbells", hint: "Handbells Used: n", colored: false },
        { key: "chime", name: "Handchimes", hint: "Handchimes Used: n", colored: true },
        { key: "smb", name: "Silver melody bells", hint: "SMBs Used: n", colored: true },
        { key: "pf", name: "P&F Handbells", hint: "P&F Handbells Used: n", colored: true },
        { key: "whitechapel", name: "Whitechapel Handbells", hint: "Whitechapel Handbells Used: n", colored: true }
    ]

    readonly property int fieldWidth: 220
    readonly property int headWidth: 220
    readonly property int shapeWidth: 160
    readonly property int noteWidth: 110
    readonly property int labelWidth: 170

    implicitWidth: failure ? 520 : content.implicitWidth + 32
    implicitHeight: (failure ? failureText.implicitHeight : content.implicitHeight) + 32

    // The choices a dropdown offers, with a stored value it does not offer
    // added at the end, so opening and saving never silently changes it.
    function choicesWith(choices, stored) {
        var list = choices.slice()
        if (stored !== null && stored !== undefined && stored !== "" && list.indexOf(stored) < 0) {
            list.push(stored)
        }
        return list
    }

    function noteChoices(stored) {
        return choicesWith(["No limit"].concat(lists.naturalNotes), stored)
    }

    function noteIndex(stored) {
        var index = noteChoices(stored).indexOf(stored || "No limit")
        return index < 0 ? 0 : index
    }

    function noteOf(box) {
        return box.currentText === "No limit" ? null : box.currentText
    }

    function valueIndex(choices, stored) {
        for (var i = 0; i < choices.length; i++) {
            if (choices[i].value === stored) return i
        }
        return 0
    }

    // "match" reads as what it does. The others are the shape's own name.
    function shapeChoices(stored) {
        var shapes = choicesWith(lists.shapes, stored)
        var choices = []
        for (var i = 0; i < shapes.length; i++) {
            var text = shapes[i] === "match" ? "As written" : shapes[i].replace("-", " ")
            choices.push({ text: text.charAt(0).toUpperCase() + text.slice(1), value: shapes[i] })
        }
        return choices
    }

    function modeChoices(stored) {
        var names = { combined: "One combined chart", separate: "A chart for each instrument" }
        var modes = choicesWith(lists.modes, stored)
        var choices = []
        for (var i = 0; i < modes.length; i++) {
            choices.push({ text: names[modes[i]] || modes[i], value: modes[i] })
        }
        return choices
    }

    // Picking a notehead fills a blank colour field from the music.
    function pickHead(colorField, head) {
        colorField.currentText = Lib.colorFor(facts.heads, head, colorField.currentText)
    }

    function recount() {
        var n = 0
        for (var i = 0; i < instrumentToggles.count; i++) {
            var toggle = instrumentToggles.itemAt(i)
            if (toggle && toggle.checked) n++
        }
        ticked = n
    }

    function textOf(field) {
        return field.currentText === "" ? null : field.currentText
    }

    function collect() {
        var chosen = JSON.parse(JSON.stringify(options))
        for (var k = 0; k < kindRows.count; k++) Object.assign(chosen, kindRows.itemAt(k).values())
        chosen.requiredBellFirst = noteOf(bellFirst)
        chosen.requiredBellLast = noteOf(bellLast)
        chosen.requiredChimeFirst = noteOf(chimeFirst)
        chosen.requiredChimeLast = noteOf(chimeLast)
        chosen.smbsOptional = smbsOptional.checked
        chosen.mode = mode.currentValue
        chosen.sharedStaff = sharedStaff.checked
        chosen.showInstrumentNames = showNames.checked

        var uncharted = []
        for (var i = 0; i < instrumentToggles.count; i++) {
            if (!instrumentToggles.itemAt(i).checked) uncharted.push(instruments[i].name)
        }
        chosen.skipParts = Lib.skipPartsFor(options.skipParts, facts.parts, uncharted) || null
        return chosen
    }

    // A form has no API for closing its own dialog, so the window is closed
    // directly. Logged once it is really hidden, for the GUI tests.
    function closeDialog() {
        var window = body.Window.window
        if (!window) return
        window.close()
        if (!window.visible) Log.info("Handbells Used Chart options closed")
    }

    // Left open after a build with warnings, so they can be read. A quiet
    // score sends them to the log alone.
    function build() {
        var result = Lib.build(collect())
        status.text = Lib.statusOf(result)
        if (result.ok) {
            options = Lib.settings()
            if (!result.warnings.length) closeDialog()
        }
    }

    function centre(item) {
        var point = item.mapToGlobal(item.width / 2, item.height / 2)
        return { x: point.x, y: point.y }
    }

    Component.onCompleted: {
        Lib.setup(api, Interactive, Log)
        try {
            lists = Lib.lists()
            options = Lib.settings()
            facts = Lib.facts()
            instruments = Lib.instruments(facts.parts, options.skipParts)
        } catch (e) {
            failure = "The options cannot be shown, because the score could not be read: "
                + (e && e.message ? e.message : String(e))
            Log.info("Handbells Used Chart options failed: " + failure)
            return
        }
        ready.start()
    }

    // Logged once the dialog is laid out, so the GUI tests can press it.
    Timer {
        id: ready
        interval: 1500
        onTriggered: Log.info("Handbells Used Chart options ready " + JSON.stringify({
            build: body.centre(buildButton),
            remove: body.centre(removeButton),
            close: body.centre(closeButton),
            sharedStaff: body.centre(sharedStaff),
            showNames: body.centre(showNames)
        }))
    }

    StyledTextLabel {
        id: failureText
        visible: body.failure !== ""
        x: 16
        y: 16
        width: 488
        wrapMode: Text.WordWrap
        horizontalAlignment: Text.AlignLeft
        text: body.failure
    }

    Column {
        id: content
        visible: body.failure === ""
        x: 16
        y: 16
        spacing: 14

        StyledTextLabel {
            text: "Instruments to chart"
            font.bold: true
        }

        StyledTextLabel {
            visible: body.instruments.length === 0
            text: "This score has no instruments of its own."
        }

        Flow {
            width: kinds.width
            spacing: 8

            Repeater {
                id: instrumentToggles
                model: body.instruments

                ToggleButton {
                    text: modelData.name || "Unnamed part"
                    checked: modelData.charted
                    enabled: modelData.skippable
                    onToggled: checked = !checked
                    onCheckedChanged: body.recount()
                }

                onItemAdded: body.recount()
            }
        }

        Row {
            spacing: 10

            StyledTextLabel {
                text: "Charts"
                width: body.labelWidth
                horizontalAlignment: Text.AlignLeft
                anchors.verticalCenter: parent.verticalCenter
            }

            QQC.ComboBox {
                id: mode
                width: body.headWidth
                enabled: body.ticked >= 2
                textRole: "text"
                valueRole: "value"
                model: body.modeChoices(body.options.mode)
                currentIndex: body.valueIndex(model, body.options.mode)
            }
        }

        SeparatorLine {
            width: kinds.width
        }

        // A row per kind. Every width is fixed, so the rows line up as columns.
        Column {
            id: kinds
            spacing: 8

            Row {
                spacing: 10

                StyledTextLabel { text: ""; width: body.labelWidth }
                StyledTextLabel { text: "Notehead"; width: body.headWidth; horizontalAlignment: Text.AlignLeft }
                StyledTextLabel { text: "Chart shape"; width: body.shapeWidth; horizontalAlignment: Text.AlignLeft }
                StyledTextLabel { text: "Label"; width: body.fieldWidth; horizontalAlignment: Text.AlignLeft }
                StyledTextLabel { text: "Colour"; width: body.noteWidth; horizontalAlignment: Text.AlignLeft }
            }

            Repeater {
                id: kindRows
                model: body.kindList

                Row {
                    spacing: 10

                    // The settings this row edits, for collect().
                    function values() {
                        var chosen = {}
                        chosen[modelData.key + "Head"] = headBox.currentValue
                        chosen[modelData.key + "Shape"] = shapeBox.currentValue
                        chosen[modelData.key + "Label"] = body.textOf(labelField)
                        if (modelData.colored) chosen[modelData.key + "Color"] = body.textOf(colorField)
                        return chosen
                    }

                    StyledTextLabel {
                        text: modelData.name
                        width: body.labelWidth
                        horizontalAlignment: Text.AlignLeft
                        anchors.verticalCenter: parent.verticalCenter
                    }
                    QQC.ComboBox {
                        id: headBox
                        width: body.headWidth
                        textRole: "text"
                        valueRole: "value"
                        model: Lib.headChoices(body.facts.heads, body.options[modelData.key + "Head"])
                        currentIndex: body.valueIndex(model, body.options[modelData.key + "Head"])
                        onActivated: if (modelData.colored) body.pickHead(colorField, currentValue)
                    }
                    QQC.ComboBox {
                        id: shapeBox
                        width: body.shapeWidth
                        textRole: "text"
                        valueRole: "value"
                        model: body.shapeChoices(body.options[modelData.key + "Shape"])
                        currentIndex: body.valueIndex(model, body.options[modelData.key + "Shape"])
                    }
                    TextInputField {
                        id: labelField
                        width: body.fieldWidth
                        hint: modelData.hint
                        currentText: body.options[modelData.key + "Label"] || ""
                        onTextChanged: function (newTextValue) { currentText = newTextValue }
                    }
                    TextInputField {
                        id: colorField
                        visible: modelData.colored
                        width: body.noteWidth
                        hint: "#c00000"
                        currentText: body.options[modelData.key + "Color"] || ""
                        onTextChanged: function (newTextValue) { currentText = newTextValue }
                    }
                }
            }
        }

        SeparatorLine {
            width: kinds.width
        }

        Grid {
            columns: 3
            columnSpacing: 10
            rowSpacing: 8
            verticalItemAlignment: Grid.AlignVCenter

            StyledTextLabel { text: ""; width: body.labelWidth }
            StyledTextLabel { text: "Required from"; width: body.noteWidth; horizontalAlignment: Text.AlignLeft }
            StyledTextLabel { text: "Required to"; width: body.noteWidth; horizontalAlignment: Text.AlignLeft }

            StyledTextLabel { text: "Handbells"; width: body.labelWidth; horizontalAlignment: Text.AlignLeft }
            QQC.ComboBox {
                id: bellFirst
                width: body.noteWidth
                model: body.noteChoices(body.options.requiredBellFirst)
                currentIndex: body.noteIndex(body.options.requiredBellFirst)
            }
            QQC.ComboBox {
                id: bellLast
                width: body.noteWidth
                model: body.noteChoices(body.options.requiredBellLast)
                currentIndex: body.noteIndex(body.options.requiredBellLast)
            }

            StyledTextLabel { text: "Handchimes"; width: body.labelWidth; horizontalAlignment: Text.AlignLeft }
            QQC.ComboBox {
                id: chimeFirst
                width: body.noteWidth
                model: body.noteChoices(body.options.requiredChimeFirst)
                currentIndex: body.noteIndex(body.options.requiredChimeFirst)
            }
            QQC.ComboBox {
                id: chimeLast
                width: body.noteWidth
                model: body.noteChoices(body.options.requiredChimeLast)
                currentIndex: body.noteIndex(body.options.requiredChimeLast)
            }
        }

        ToggleButton {
            id: smbsOptional
            text: "Silver melody bells are optional"
            checked: body.options.smbsOptional === true
            onToggled: checked = !checked
        }

        SeparatorLine {
            width: kinds.width
        }

        ToggleButton {
            id: sharedStaff
            text: "Put every chart on one staff"
            checked: body.options.sharedStaff === true
            onToggled: checked = !checked
        }

        ToggleButton {
            id: showNames
            text: "Name each chart beside its staff"
            checked: body.options.showInstrumentNames === true
            onToggled: checked = !checked
        }

        SeparatorLine {
            width: kinds.width
        }

        Row {
            spacing: 8

            FlatButton {
                id: buildButton
                text: "Build Chart"
                accentButton: true
                onClicked: body.build()
            }

            FlatButton {
                id: removeButton
                text: "Remove Chart"
                onClicked: status.text = Lib.remove().summary
            }

            FlatButton {
                id: closeButton
                text: "Close"
                onClicked: body.closeDialog()
            }
        }

        StyledTextLabel {
            id: status
            width: kinds.width
            wrapMode: Text.WordWrap
            horizontalAlignment: Text.AlignLeft
        }
    }
}
