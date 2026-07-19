@echo off
call C:\Miniconda3\Scripts\activate.bat dev
cd /d C:\Users\frede\Documents\GitHub\CodeOfMe\FlyingDream
pip install -e . -q
python -m feitian
pause
