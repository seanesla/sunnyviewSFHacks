import unittest

import os
import sys

import numpy as np

_SEGMENTER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _SEGMENTER_DIR not in sys.path:
    sys.path.insert(0, _SEGMENTER_DIR)

from postprocess import (
    choose_component_by_footprint,
    extract_geojson_ring,
    keep_component,
    mask_to_polygon_norm,
    ring_norm_to_mask,
)


class TestPostprocess(unittest.TestCase):
    def test_extract_geojson_ring_polygon(self) -> None:
        poly = {
            "type": "Polygon",
            "coordinates": [
                [
                    [0.1, 0.2],
                    [0.9, 0.2],
                    [0.9, 0.8],
                    [0.1, 0.8],
                    [0.1, 0.2],
                ]
            ],
        }
        ring = extract_geojson_ring(poly)
        self.assertIsNotNone(ring)
        assert ring is not None
        self.assertEqual(len(ring), 4)

    def test_ring_to_mask(self) -> None:
        ring = [(0.2, 0.2), (0.8, 0.2), (0.8, 0.8), (0.2, 0.8)]
        m = ring_norm_to_mask(ring, w=100, h=100)
        self.assertEqual(m.shape, (100, 100))
        self.assertGreater(int(m.sum()), 1000)

    def test_choose_component_by_footprint(self) -> None:
        # Two components; footprint overlaps the right one.
        m = np.zeros((64, 64), dtype=np.uint8)
        m[10:20, 10:20] = 1
        m[40:55, 40:55] = 1
        footprint = np.zeros((64, 64), dtype=np.uint8)
        footprint[42:54, 42:54] = 1
        chosen = choose_component_by_footprint(m, footprint)
        self.assertGreater(int(chosen[45:50, 45:50].sum()), 5)
        self.assertEqual(int(chosen[12:18, 12:18].sum()), 0)

    def test_mask_to_polygon_norm(self) -> None:
        m = np.zeros((80, 120), dtype=np.uint8)
        m[20:60, 30:100] = 1
        poly = mask_to_polygon_norm(m, w=120, h=80)
        self.assertIsNotNone(poly)
        assert poly is not None
        self.assertEqual(poly.get("type"), "Polygon")
        coords = poly.get("coordinates")
        self.assertTrue(isinstance(coords, list))

    def test_keep_component_click_in_hole_prefers_nearest(self) -> None:
        # Courtyard-style roof: click lands in a hole inside the roof mask.
        m = np.zeros((160, 160), dtype=np.uint8)

        # Large far-away component (would be selected by "largest" fallback).
        # Keep a 2px gap to avoid 8-connectivity diagonal merging.
        m[0:58, 0:58] = 1

        # Donut component around the click.
        m[70:110, 70:110] = 1
        m[80:100, 80:100] = 0

        chosen = keep_component(m, cx=90, cy=90)

        # Should pick the donut, not the far-away block.
        self.assertEqual(int(chosen[10:40, 10:40].sum()), 0)
        self.assertGreater(int(chosen[72:108, 72:108].sum()), 200)


if __name__ == "__main__":
    unittest.main()
