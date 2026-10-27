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

    readonly property int fieldWidth: 220
    readonly property int headWidth: 220
    readonly property int shapeWidth: 160
    readonly property int noteWidth: 110
    readonly property int labelWidth: 170

    implicitWidth: content.implicitWidth + 32
    implicitHeight: content.implicitHeight + 32

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
        if (colorField) colorField.currentText = Lib.colorFor(facts.heads, head, colorField.currentText)
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
        chosen.bellLabel = textOf(bellLabel)
        chosen.chimeLabel = textOf(chimeLabel)
        chosen.smbLabel = textOf(smbLabel)
        chosen.pfLabel = textOf(pfLabel)
        chosen.whitechapelLabel = textOf(whitechapelLabel)
        chosen.chimeColor = textOf(chimeColor)
        chosen.smbColor = textOf(smbColor)
        chosen.pfColor = textOf(pfColor)
        chosen.whitechapelColor = textOf(whitechapelColor)
        chosen.bellHead = bellHead.currentValue
        chosen.chimeHead = chimeHead.currentValue
        chosen.smbHead = smbHead.currentValue
        chosen.pfHead = pfHead.currentValue
        chosen.whitechapelHead = whitechapelHead.currentValue
        chosen.bellShape = bellShape.currentValue
        chosen.chimeShape = chimeShape.currentValue
        chosen.smbShape = smbShape.currentValue
        chosen.pfShape = pfShape.currentValue
        chosen.whitechapelShape = whitechapelShape.currentValue
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
            var toggle = instrumentToggles.itemAt(i)
            if (!toggle.checked) uncharted.push(toggle.text)
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

    function build() {
        var result = Lib.build(collect())
        status.text = result.summary
        if (result.ok) {
            options = Lib.settings()
            closeDialog()
        }
    }

    function centre(item) {
        var point = item.mapToGlobal(item.width / 2, item.height / 2)
        return { x: point.x, y: point.y }
    }

    Component.onCompleted: {
        Lib.setup(api, Interactive, Log)
        lists = Lib.lists()
        options = Lib.settings()
        facts = Lib.facts()
        instruments = Lib.instruments(facts.parts, options.skipParts)
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

    Column {
        id: content
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
                    text: modelData.name
                    checked: modelData.charted
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

        Grid {
            id: kinds
            columns: 5
            columnSpacing: 10
            rowSpacing: 8
            verticalItemAlignment: Grid.AlignVCenter

            StyledTextLabel { text: ""; width: body.labelWidth }
            StyledTextLabel { text: "Notehead"; width: body.headWidth; horizontalAlignment: Text.AlignLeft }
            StyledTextLabel { text: "Chart shape"; width: body.shapeWidth; horizontalAlignment: Text.AlignLeft }
            StyledTextLabel { text: "Label"; width: body.fieldWidth; horizontalAlignment: Text.AlignLeft }
            StyledTextLabel { text: "Colour"; width: body.noteWidth; horizontalAlignment: Text.AlignLeft }

            StyledTextLabel { text: "Handbells"; width: body.labelWidth; horizontalAlignment: Text.AlignLeft }
            QQC.ComboBox {
                id: bellHead
                width: body.headWidth
                textRole: "text"
                valueRole: "value"
                model: Lib.headChoices(body.facts.heads, body.options.bellHead)
                currentIndex: body.valueIndex(model, body.options.bellHead)
                onActivated: body.pickHead(null, currentValue)
            }
            QQC.ComboBox {
                id: bellShape
                width: body.shapeWidth
                textRole: "text"
                valueRole: "value"
                model: body.shapeChoices(body.options.bellShape)
                currentIndex: body.valueIndex(model, body.options.bellShape)
            }
            TextInputField {
                id: bellLabel
                width: body.fieldWidth
                hint: "Handbells Used: n"
                currentText: body.options.bellLabel || ""
                onTextChanged: function (newTextValue) { currentText = newTextValue }
            }
            Item { width: body.noteWidth; height: 1 }

            StyledTextLabel { text: "Handchimes"; width: body.labelWidth; horizontalAlignment: Text.AlignLeft }
            QQC.ComboBox {
                id: chimeHead
                width: body.headWidth
                textRole: "text"
                valueRole: "value"
                model: Lib.headChoices(body.facts.heads, body.options.chimeHead)
                currentIndex: body.valueIndex(model, body.options.chimeHead)
                onActivated: body.pickHead(chimeColor, currentValue)
            }
            QQC.ComboBox {
                id: chimeShape
                width: body.shapeWidth
                textRole: "text"
                valueRole: "value"
                model: body.shapeChoices(body.options.chimeShape)
                currentIndex: body.valueIndex(model, body.options.chimeShape)
            }
            TextInputField {
                id: chimeLabel
                width: body.fieldWidth
                hint: "Handchimes Used: n"
                currentText: body.options.chimeLabel || ""
                onTextChanged: function (newTextValue) { currentText = newTextValue }
            }
            TextInputField {
                id: chimeColor
                width: body.noteWidth
                hint: "#c00000"
                currentText: Lib.colorFor(body.facts.heads, body.options.chimeHead, body.options.chimeColor || "")
                onTextChanged: function (newTextValue) { currentText = newTextValue }
            }

            StyledTextLabel { text: "Silver melody bells"; width: body.labelWidth; horizontalAlignment: Text.AlignLeft }
            QQC.ComboBox {
                id: smbHead
                width: body.headWidth
                textRole: "text"
                valueRole: "value"
                model: Lib.headChoices(body.facts.heads, body.options.smbHead)
                currentIndex: body.valueIndex(model, body.options.smbHead)
                onActivated: body.pickHead(smbColor, currentValue)
            }
            QQC.ComboBox {
                id: smbShape
                width: body.shapeWidth
                textRole: "text"
                valueRole: "value"
                model: body.shapeChoices(body.options.smbShape)
                currentIndex: body.valueIndex(model, body.options.smbShape)
            }
            TextInputField {
                id: smbLabel
                width: body.fieldWidth
                hint: "SMBs Used: n"
                currentText: body.options.smbLabel || ""
                onTextChanged: function (newTextValue) { currentText = newTextValue }
            }
            TextInputField {
                id: smbColor
                width: body.noteWidth
                hint: "#c00000"
                currentText: Lib.colorFor(body.facts.heads, body.options.smbHead, body.options.smbColor || "")
                onTextChanged: function (newTextValue) { currentText = newTextValue }
            }

            StyledTextLabel { text: "P&F Handbells"; width: body.labelWidth; horizontalAlignment: Text.AlignLeft }
            QQC.ComboBox {
                id: pfHead
                width: body.headWidth
                textRole: "text"
                valueRole: "value"
                model: Lib.headChoices(body.facts.heads, body.options.pfHead)
                currentIndex: body.valueIndex(model, body.options.pfHead)
                onActivated: body.pickHead(pfColor, currentValue)
            }
            QQC.ComboBox {
                id: pfShape
                width: body.shapeWidth
                textRole: "text"
                valueRole: "value"
                model: body.shapeChoices(body.options.pfShape)
                currentIndex: body.valueIndex(model, body.options.pfShape)
            }
            TextInputField {
                id: pfLabel
                width: body.fieldWidth
                hint: "P&F Handbells Used: n"
                currentText: body.options.pfLabel || ""
                onTextChanged: function (newTextValue) { currentText = newTextValue }
            }
            TextInputField {
                id: pfColor
                width: body.noteWidth
                hint: "#c00000"
                currentText: Lib.colorFor(body.facts.heads, body.options.pfHead, body.options.pfColor || "")
                onTextChanged: function (newTextValue) { currentText = newTextValue }
            }

            StyledTextLabel { text: "Whitechapel Handbells"; width: body.labelWidth; horizontalAlignment: Text.AlignLeft }
            QQC.ComboBox {
                id: whitechapelHead
                width: body.headWidth
                textRole: "text"
                valueRole: "value"
                model: Lib.headChoices(body.facts.heads, body.options.whitechapelHead)
                currentIndex: body.valueIndex(model, body.options.whitechapelHead)
                onActivated: body.pickHead(whitechapelColor, currentValue)
            }
            QQC.ComboBox {
                id: whitechapelShape
                width: body.shapeWidth
                textRole: "text"
                valueRole: "value"
                model: body.shapeChoices(body.options.whitechapelShape)
                currentIndex: body.valueIndex(model, body.options.whitechapelShape)
            }
            TextInputField {
                id: whitechapelLabel
                width: body.fieldWidth
                hint: "Whitechapel Handbells Used: n"
                currentText: body.options.whitechapelLabel || ""
                onTextChanged: function (newTextValue) { currentText = newTextValue }
            }
            TextInputField {
                id: whitechapelColor
                width: body.noteWidth
                hint: "#c00000"
                currentText: Lib.colorFor(body.facts.heads, body.options.whitechapelHead, body.options.whitechapelColor || "")
                onTextChanged: function (newTextValue) { currentText = newTextValue }
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
