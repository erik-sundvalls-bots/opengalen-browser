# OpenGALEN 8 extraction checks

Built 2026-11-16T14:48:00Z.

## Counts

| Check | Result |
|---|---|
| pass | implies lines 246576 (expected 246576) |
| pass | equivalent lines 1664 (expected 1664) |
| pass | class declaration lines 164626 (expected 164626) |
| pass | unique class names 125389 from 164626 declaration lines (duplicates are a translation artefact) |
| pass | EquivalentClasses axioms 154509 (expected 154509) |
| pass | SubClassOf axioms 54285 (expected 54285) |
| pass | PulmonaryAtresia implies CongenitalPathologywhichinvolvesHeartChamber |
| pass | PulmonaryAtresiaWithVentricularSeptalDefect has ancestor PhenomenonwhichinvolvesHeart (inferred, not a direct dump line) |
| pass | PulmonaryAtresiaWithVentricularSeptalDefect / PhenomenonwhichinvolvesHeart is not an asserted SubClassOf |
| pass | classifier artefacts removed: 2 (expected 2) |
| pass | BodyStructure parents == {OrganicSolidStructure} (was Adenoma plus its which-class) |
| pass | Heart does not have ancestor Adenoma |
| pass | Hand does not have ancestor Adenoma |
| pass | Femur does not have ancestor Adenoma |
| pass | Thumb does not have ancestor Adenoma |
| pass | VillousAdenoma still has ancestor Adenoma |
| pass | known cyclic implies edges dropped: 5 (expected 5) |
| pass | first and OrdinalPositionValueType are in the graph |
| pass | first has told OWL parent OrdinalPositionValueType (omitted from the dump) |
| pass | first reaches SymbolicValueType via the restored value-type chain |
| pass | told value-type parents restored: 22 |

## Sizes

- graph.bin.gz: 2,719,741 bytes
- search.bin.gz: 3,122,406 bytes
- labels.json.gz: 41,921 bytes
- definition shards: 246 files, 3,114,691 bytes
- props.json.gz: 3,247 bytes
- relationship shards: 246 files, 441,220 bytes, 149,129 edges on 106,275 concepts in 52 groups
- concepts in the browser graph: 125,511 (declarations plus any dump-only names)
- generated names hidden by default: 90,775
- default concept: `Asthma`

The plan's class count, 164,626, is the number of `Declaration(Class …)` lines. Those lines name 125,389 unique classes; the OWL release notes say duplicate declarations are translation artefacts. The browser graph has 125,511 concepts (unique declarations plus dump names that were not declared).

Dissection-rubric annotation lines: 97,170 (39,690 concepts). Sanction-level lines: 213,606 (74,068 concepts). Language-annotation lines: 9,000 (4,193 concepts).

Parent links stored in the graph are unique. The dump has 246,576 implies lines, 244,980 unique pairs, and 436 self-implies that are ignored. Two unique pairs are classifier artefacts in that with-chains dump only (lines 32231–32237 `BodyStructure` implies `Adenoma`, and lines 33133–33137 `BodyStructure` implies Adenoma's defining which-class `PathologicalBodyStructurewhichhasUniqueAssociatedProcessNeoplasticProcesswhichactsSpecificallyOnTissueCell`). They are not told GRAIL or OWL axioms and are absent from the no-chains full dump and the CRM-only dump, so they are removed before cycle breaking. Five remaining implies-cycles, all long surgical-procedure names, are dropped so the neighbourhood can be drawn as a DAG:

- `SurgicalDeedwhichisCharacterisedByperformancewhichisEnactmentOfSurgicalFixingwhichhasSpecificPhysicalMeansSurgicalExternalFixationDeviceisMainlyCharacterisedByperformancewhichisEnactmentOfAligningwhichhasSpecificGoalNormalisingProcessplaysClinicalRoleSurgicalRolehasSpecificSubprocessSurgicalApproachingwhichhasSurgicalOpenClosednessSurgicalOpenClosednesswhichhasAbsoluteStatesurgicallyClosedactsSpecificallyOnFemoralFracture` implies `SurgicalDeedwhichisCharacterisedByperformancewhichisEnactmentOfSurgicalFixingwhichhasSpecificPhysicalMeansSurgicalExternalFixationDeviceisMainlyCharacterisedByperformancewhichisEnactmentOfAligningwhichhasSpecificGoalNormalisingProcessplaysClinicalRoleSurgicalRolehasSpecificSubprocessSurgicalApproachingwhichhasSurgicalOpenClosednessSurgicalOpenClosednesswhichhasAbsoluteStatesurgicallyClosedactsSpecificallyOnBonyFracturewhichhasSpecificLoca` (edge dropped)
- `SurgicalDeedwhichisCharacterisedByperformancewhichisEnactmentOfSurgicalFixingwhichhasSpecificPhysicalMeansSurgicalExternalFixationDeviceisMainlyCharacterisedByperformancewhichisEnactmentOfAligningwhichhasSpecificGoalNormalisingProcessplaysClinicalRoleSurgicalRolehasSpecificSubprocessSurgicalApproachingwhichhasSurgicalOpenClosednessSurgicalOpenClosednesswhichhasAbsoluteStatesurgicallyClosedactsSpecificallyOnHumeralFracture` implies `SurgicalDeedwhichisCharacterisedByperformancewhichisEnactmentOfSurgicalFixingwhichhasSpecificPhysicalMeansSurgicalExternalFixationDeviceisMainlyCharacterisedByperformancewhichisEnactmentOfAligningwhichhasSpecificGoalNormalisingProcessplaysClinicalRoleSurgicalRolehasSpecificSubprocessSurgicalApproachingwhichhasSurgicalOpenClosednessSurgicalOpenClosednesswhichhasAbsoluteStatesurgicallyClosedactsSpecificallyOnBonyFracturewhichhasSpecificLoca` (edge dropped)
- `SurgicalDeedwhichisCharacterisedByperformancewhichisEnactmentOfSurgicalFixingwhichhasSpecificPhysicalMeansSurgicalExternalFixationDeviceisMainlyCharacterisedByperformancewhichisEnactmentOfAligningwhichhasSpecificGoalNormalisingProcessplaysClinicalRoleSurgicalRolehasSpecificSubprocessSurgicalApproachingwhichhasSurgicalOpenClosednessSurgicalOpenClosednesswhichhasAbsoluteStatesurgicallyClosedactsSpecificallyOnRadialFracture` implies `SurgicalDeedwhichisCharacterisedByperformancewhichisEnactmentOfSurgicalFixingwhichhasSpecificPhysicalMeansSurgicalExternalFixationDeviceisMainlyCharacterisedByperformancewhichisEnactmentOfAligningwhichhasSpecificGoalNormalisingProcessplaysClinicalRoleSurgicalRolehasSpecificSubprocessSurgicalApproachingwhichhasSurgicalOpenClosednessSurgicalOpenClosednesswhichhasAbsoluteStatesurgicallyClosedactsSpecificallyOnBonyFracturewhichhasSpecificLoca` (edge dropped)
- `SurgicalDeedwhichisCharacterisedByperformancewhichisEnactmentOfSurgicalFixingwhichhasSpecificPhysicalMeansSurgicalExternalFixationDeviceisMainlyCharacterisedByperformancewhichisEnactmentOfAligningwhichhasSpecificGoalNormalisingProcessplaysClinicalRoleSurgicalRolehasSpecificSubprocessSurgicalApproachingwhichhasSurgicalOpenClosednessSurgicalOpenClosednesswhichhasAbsoluteStatesurgicallyClosedactsSpecificallyOnTibialFracture` implies `SurgicalDeedwhichisCharacterisedByperformancewhichisEnactmentOfSurgicalFixingwhichhasSpecificPhysicalMeansSurgicalExternalFixationDeviceisMainlyCharacterisedByperformancewhichisEnactmentOfAligningwhichhasSpecificGoalNormalisingProcessplaysClinicalRoleSurgicalRolehasSpecificSubprocessSurgicalApproachingwhichhasSurgicalOpenClosednessSurgicalOpenClosednesswhichhasAbsoluteStatesurgicallyClosedactsSpecificallyOnBonyFracturewhichhasSpecificLoca` (edge dropped)
- `SurgicalDeedwhichisCharacterisedByperformancewhichisEnactmentOfSurgicalFixingwhichhasSpecificPhysicalMeansSurgicalExternalFixationDeviceisMainlyCharacterisedByperformancewhichisEnactmentOfAligningwhichhasSpecificGoalNormalisingProcessplaysClinicalRoleSurgicalRolehasSpecificSubprocessSurgicalApproachingwhichhasSurgicalOpenClosednessSurgicalOpenClosednesswhichhasAbsoluteStatesurgicallyClosedactsSpecificallyOnUlnarFracture` implies `SurgicalDeedwhichisCharacterisedByperformancewhichisEnactmentOfSurgicalFixingwhichhasSpecificPhysicalMeansSurgicalExternalFixationDeviceisMainlyCharacterisedByperformancewhichisEnactmentOfAligningwhichhasSpecificGoalNormalisingProcessplaysClinicalRoleSurgicalRolehasSpecificSubprocessSurgicalApproachingwhichhasSurgicalOpenClosednessSurgicalOpenClosednesswhichhasAbsoluteStatesurgicallyClosedactsSpecificallyOnBonyFracturewhichhasSpecificLoca` (edge dropped)

Five narrower generated-class inversions are still in the graph and were not changed. The HeartBeat and tachycardia edges are absent from the no-chains full dump. The SurgicalAblating edge is present there too:

- `HeartBeat` implies `PhenomenonwhichinvolvesSubstance` (kept)
- `SurgicalAblating` implies `SolidRemovingProcesswhichplaysClinicalRoleSurgicalRole` (kept)
- `Tachycardia` implies `TemporalFeaturewhichinvolvesHearthasPathologicalStatuspathological` (kept)
- `SupraventricularTachycardia` implies `TemporalFeaturewhichinvolvesDepolarisationwhichisSpecificFunctionOfAtrialStructurehasPathologicalStatuspathological` (kept)
- `SinusTachycardia` implies `TemporalFeaturewhichinvolvesSinoAtrialNodeDepolarisationhasPathologicalStatuspathological` (kept)

The classified dump has no `implies` line for the GRAIL ordinal-position selectors (`OrdinalPositionValueType newSub [first second … fifteenth]` in `GRAIL_Sources/64-3434624046.grl`) or for some other parentless `*ValueType` leaves. The told OWL axioms are present, e.g. `SubClassOf(first OrdinalPositionValueType)` in `OpenGALEN8_FoundationModel_TopClassesForMedicalDomain.owl` line 1763, and `SubClassOf(OrdinalPositionValueType SymbolicValueType)` in `OpenGALEN8_GenericModel.owl` line 156. Those told parents are restored when the dump left the child with none (22 links):

- `DateValueType` ⊑ `MagnitudeValueType` (told OWL, omitted from the dump)
- `FractionalRange` ⊑ `ImpreciseNumberValueType` (told OWL, omitted from the dump)
- `ImpreciseNumberValueType` ⊑ `MagnitudeValueType` (told OWL, omitted from the dump)
- `NumberValueType` ⊑ `MagnitudeValueType` (told OWL, omitted from the dump)
- `NumericalRangeValueType` ⊑ `MagnitudeValueType` (told OWL, omitted from the dump)
- `OrdinalPositionValueType` ⊑ `SymbolicValueType` (told OWL, omitted from the dump)
- `eighth` ⊑ `OrdinalPositionValueType` (told OWL, omitted from the dump)
- `eleventh` ⊑ `OrdinalPositionValueType` (told OWL, omitted from the dump)
- `fifteenth` ⊑ `OrdinalPositionValueType` (told OWL, omitted from the dump)
- `fifth` ⊑ `OrdinalPositionValueType` (told OWL, omitted from the dump)
- `first` ⊑ `OrdinalPositionValueType` (told OWL, omitted from the dump)
- `fourteenth` ⊑ `OrdinalPositionValueType` (told OWL, omitted from the dump)
- `fourth` ⊑ `OrdinalPositionValueType` (told OWL, omitted from the dump)
- `ninth` ⊑ `OrdinalPositionValueType` (told OWL, omitted from the dump)
- `oneOrMore` ⊑ `ImpreciseNumberValueType` (told OWL, omitted from the dump)
- `second` ⊑ `OrdinalPositionValueType` (told OWL, omitted from the dump)
- `seventh` ⊑ `OrdinalPositionValueType` (told OWL, omitted from the dump)
- `sixth` ⊑ `OrdinalPositionValueType` (told OWL, omitted from the dump)
- `tenth` ⊑ `OrdinalPositionValueType` (told OWL, omitted from the dump)
- `third` ⊑ `OrdinalPositionValueType` (told OWL, omitted from the dump)
- `thirteenth` ⊑ `OrdinalPositionValueType` (told OWL, omitted from the dump)
- `twelvth` ⊑ `OrdinalPositionValueType` (told OWL, omitted from the dump)

`PulmonaryAtresiaWithVentricularSeptalDefect` is not a direct child of `PhenomenonwhichinvolvesHeart` in the dump. Walking parents does reach that concept, and no OWL `SubClassOf` axiom states the pair. Direct spot-check: `PulmonaryAtresia` implies `CongenitalPathologywhichinvolvesHeartChamber`.
