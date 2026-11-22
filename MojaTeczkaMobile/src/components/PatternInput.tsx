import React, { useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
export default function PatternInput({ onChange, disabled = false }: { onChange: (value: string) => void; disabled?: boolean }) {
 const points = useRef<number[]>([]); const [selected, setSelected] = useState<number[]>([]);
 const callback = useRef(onChange); callback.current = onChange;
 const blocked = useRef(disabled); blocked.current = disabled;
 const responder = useRef(PanResponder.create({
  onStartShouldSetPanResponder: () => !blocked.current,
  onMoveShouldSetPanResponder: () => !blocked.current,
  onPanResponderGrant: event => { points.current = []; setSelected([]); visit(event.nativeEvent.locationX, event.nativeEvent.locationY); },
  onPanResponderMove: event => visit(event.nativeEvent.locationX, event.nativeEvent.locationY),
  onPanResponderRelease: () => callback.current(points.current.join('-')),
  onPanResponderTerminate: () => { points.current = []; setSelected([]); callback.current(''); }
 })).current;
 function visit(x: number, y: number) {
  const col = Math.round((x - 40) / 80), row = Math.round((y - 40) / 80);
  if (col < 0 || col > 2 || row < 0 || row > 2 || Math.hypot(x-(40+col*80),y-(40+row*80)) > 30) return;
  const next=row*3+col; if (points.current.includes(next)) return;
  const last=points.current[points.current.length-1];
  if (last !== undefined) { const oldRow=Math.floor(last/3), oldCol=last%3; const mr=(oldRow+row)/2, mc=(oldCol+col)/2; if(Number.isInteger(mr)&&Number.isInteger(mc)){const middle=mr*3+mc;if(!points.current.includes(middle))points.current.push(middle);} }
  points.current.push(next); setSelected([...points.current]);
 }
 return <View style={{alignItems:'center'}}><View accessibilityLabel="Narysuj wzór łączący co najmniej cztery punkty" style={styles.grid} {...responder.panHandlers}>{Array.from({length:9},(_,index)=><View pointerEvents="none" key={index} style={[styles.dot,{left:20+(index%3)*80,top:20+Math.floor(index/3)*80},selected.includes(index)&&styles.active]}><Text style={styles.number}>{selected.includes(index)?selected.indexOf(index)+1:''}</Text></View>)}</View><Text style={styles.hint}>Połącz co najmniej 4 różne punkty jednym gestem.</Text></View>;
}
const styles=StyleSheet.create({grid:{width:240,height:240,borderRadius:18,backgroundColor:'#0f172a'},dot:{position:'absolute',width:40,height:40,borderRadius:20,borderWidth:2,borderColor:'#64748b',alignItems:'center',justifyContent:'center'},active:{backgroundColor:'#2563eb',borderColor:'#93c5fd'},number:{color:'white',fontWeight:'700'},hint:{color:'#94a3b8',fontSize:12,marginTop:8,textAlign:'center'}});
