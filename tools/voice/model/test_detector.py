import json
from pathlib import Path
import tempfile
import unittest
import wave
import numpy as np
from detector import Detector, features, WINDOW, HOP, SHAPE, digest, load_candidate
from train import corpus, model
import torch

class DetectorTest(unittest.TestCase):
    def test_features(self):
        x=np.zeros(WINDOW,dtype=np.int16)
        self.assertEqual(features(x).shape,SHAPE)
        self.assertTrue(np.isfinite(features(x)).all())
        self.assertEqual(features(x).dtype,np.float32)
        with self.assertRaises(ValueError):
            features(x[:-1])

    def test_split_chunks(self):
        data=np.arange(WINDOW+HOP*5,dtype=np.int16)
        a,b=Detector(lambda f:.8,.7),Detector(lambda f:.8,.7)
        def run(d,n):
            return [s for i in range(0,len(data),n) for s in d.feed(data[i:i+n])]
        self.assertEqual(run(a,HOP),run(b,317))
        self.assertEqual(a.samples,len(data))
        self.assertEqual(sum(s["wake"] for s in run(Detector(lambda f:.8,.7),HOP)),1)

    def test_reset_and_cooldown(self):
        p=[.9]
        d=Detector(lambda f:p[0],.8)
        chunk=np.zeros(HOP,dtype=np.int16)
        for _ in range(WINDOW//HOP-1):
            self.assertEqual(d.feed(chunk),[])
        self.assertFalse(d.feed(chunk)[0]["wake"])
        self.assertTrue(d.feed(chunk)[0]["wake"])
        for _ in range(25):
            self.assertFalse(d.feed(chunk)[0]["wake"])
        p[0]=.1
        d.feed(chunk)
        p[0]=.9
        self.assertFalse(d.feed(chunk)[0]["wake"])
        self.assertTrue(d.feed(chunk)[0]["wake"])
        d.reset()
        self.assertEqual(d.feed(chunk),[])
        self.assertEqual(d.samples,HOP)

    def test_invalid_score(self):
        d=Detector(lambda f:float("nan"),.5)
        chunk=np.zeros(HOP,dtype=np.int16)
        for _ in range(WINDOW//HOP-1):
            d.feed(chunk)
        with self.assertRaises(ValueError):
            d.feed(chunk)
        self.assertEqual(d.samples,0)

    def test_architectures(self):
        torch.set_num_threads(1)
        for kind in ("ds","temporal"):
            net=model(kind).eval()
            self.assertEqual(tuple(net(torch.zeros(SHAPE)).shape),(1,1))
            self.assertLess(sum(p.numel() for p in net.parameters()),50000)

    def test_leakage_and_hash(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            wav=root/"a.wav"
            with wave.open(str(wav),"wb") as f:
                f.setparams((1,2,16000,0,"NONE","not compressed"))
                f.writeframes(bytes(3200))
            row={"file":"a.wav","positive":True,"split":"train","start":0,"end":1600,
                 "rights":"synthetic-research-only","speaker":"s","source_id":"a","sha256":digest(wav)}
            manifest=root/"manifest.json"
            manifest.write_text(json.dumps([row,{**row,"split":"test"}]))
            with self.assertRaisesRegex(ValueError,"cross-split leakage"):
                corpus(manifest)
            manifest.write_text(json.dumps([{**row,"sha256":"invalid"}]))
            with self.assertRaisesRegex(ValueError,"hash mismatch"):
                corpus(manifest)

if __name__=="__main__":
    unittest.main()
