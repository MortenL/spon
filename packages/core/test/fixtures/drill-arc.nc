%
(Spon fixture: arcs, a G83 peck cycle and one rapid into the stock)
G21 G90 G17 G54
T1 M6
G43 H1
S12000 M3
G0 Z5
G0 X5 Y5
G1 Z-1 F300
G2 X15 Y5 I5 J0 F800
G3 X5 Y5 R5
G0 Z5
G0 X25 Y15
G83 X25 Y15 Z-4 R1 Q1 F200
G80
G0 Z5
G0 X10 Y10
G0 Z-2 (deliberate error: rapid into the stock)
G0 Z5
M5
M30
%
