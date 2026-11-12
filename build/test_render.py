#!/usr/bin/env python3
"""Renderer tests that do not need the OpenGALEN zips."""

import unittest

from og8_extract import axiom_call, is_generated, render


class RenderTests(unittest.TestCase):
    def test_simple_which(self):
        line = (
            "EquivalentClasses(<http://www.opengalen.org/owl/opengalen.owl#AbnormalColour> "
            "ObjectIntersectionOf(ObjectSomeValuesFrom("
            "<http://www.opengalen.org/owl/opengalen.owl#hasAbnormalityStatus> "
            "<http://www.opengalen.org/owl/opengalen.owl#nonNormal>) "
            "<http://www.opengalen.org/owl/opengalen.owl#Colour>))"
        )
        node = axiom_call(line)
        self.assertEqual(node[0], "EquivalentClasses")
        self.assertEqual(render(node[1][1]), "Colour which hasAbnormalityStatus nonNormal")

    def test_nested_which(self):
        line = (
            "EquivalentClasses(<http://www.opengalen.org/owl/opengalen.owl#AnatomicalSurfaceQuadrant> "
            "ObjectIntersectionOf(ObjectSomeValuesFrom("
            "<http://www.opengalen.org/owl/opengalen.owl#hasShapeAnalagousTo> "
            "ObjectIntersectionOf(ObjectSomeValuesFrom("
            "<http://www.opengalen.org/owl/opengalen.owl#hasAbsoluteState> "
            "<http://www.opengalen.org/owl/opengalen.owl#quarterCircular>) "
            "<http://www.opengalen.org/owl/opengalen.owl#AnatomicalShape>)) "
            "<http://www.opengalen.org/owl/opengalen.owl#SurfaceRegion>))"
        )
        node = axiom_call(line)
        text = render(node[1][1])
        self.assertEqual(
            text,
            "SurfaceRegion which hasShapeAnalagousTo (AnatomicalShape which hasAbsoluteState quarterCircular)",
        )

    def test_named_equivalent_has_no_fake_which(self):
        line = (
            "EquivalentClasses(<http://www.opengalen.org/owl/opengalen.owl#AnteriorBodyWall> "
            "<http://www.opengalen.org/owl/opengalen.owl#AtLeastPairedBodyWallwhichhasAnteriorPosteriorSelectoranteriorSelection>)"
        )
        node = axiom_call(line)
        named = [arg for arg in node[1] if isinstance(arg, str)]
        self.assertEqual(named[0], "AnteriorBodyWall")
        self.assertIn("which", named[1])

    def test_generated_heuristic(self):
        self.assertFalse(is_generated("Heart"))
        self.assertFalse(is_generated("PhenomenonwhichinvolvesHeart"))
        self.assertTrue(
            is_generated(
                "ClinicalSituationwhichisMainlyCharacterisedByperformancewhichisEnactmentOfExcising"
            )
        )
        self.assertTrue(is_generated("DrugwhichhasSpecificIngredientAmifostineWhichIsVeryLongNameIndeed"))


if __name__ == "__main__":
    unittest.main()
