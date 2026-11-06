---
version: 1.0
updatedAt: 2026-11-04
title: "A Equação do Manipulador: Inércia, Coriolis, Gravidade"
summary: "A forma padrão da equação do manipulador, por que a matriz C não é única, a escolha pelos símbolos de Christoffel que torna Mdot menos 2C antissimétrica, e o efeito físico dos termos de inércia, centrífugo, de Coriolis e de gravidade, simulados um de cada vez num braço de dois elos."
---
## Objetivos de Aprendizagem

- Escrever a equação do manipulador $M(q)\ddot q+C(q,\dot q)\dot q+g(q)=\tau$ e dizer quais partes são únicas ($M$, $g$ e o vetor $C\dot q$) e qual parte é uma escolha (a matriz $C$).
- Montar $C$ pelos símbolos de Christoffel e mostrar, numa execução, que $\dot M-2C$ é antissimétrica nessa escolha e não em outras escolhas válidas.
- Separar a antissimetria da identidade de energia $\dot q^T(\dot M-2C)\dot q=0$, que toda $C$ válida satisfaz.
- Dizer o efeito físico dos termos de inércia, centrífugo, de Coriolis e de gravidade simulando um de cada vez, e prever como cada um escala com a velocidade.

## Contexto e Motivação

`lagrangian-dynamics-of-an-open-chain-robot` produziu os dois torques de um braço planar como expressões longas. Controladores, simuladores e provas de estabilidade precisam deles num formato padrão, em que cada termo tem nome e matriz. Esse formato é a equação do manipulador. Ela parece única, mas uma de suas matrizes não é, e uma propriedade usada em provas de controle vale só para uma escolha particular dela. A segunda metade da lição liga e desliga cada termo em simulação, porque "termo de Coriolis" diz pouco até você ver o que o braço faz sem ele.

## Teoria Central

### A forma padrão

$$M(q)\,\ddot q+C(q,\dot q)\,\dot q+g(q)=\tau.$$

$M(q)$ é a matriz de massa, simétrica e definida positiva, de modo que $K=\tfrac12\dot q^TM\dot q$. $g(q)=\partial P/\partial q$ reúne a gravidade. $C(q,\dot q)\dot q$ reúne tudo o que é quadrático na velocidade. As convenções variam entre as fontes. O *Modern Robotics* escreve primeiro com um vetor de velocidade, $M\ddot\theta+c(\theta,\dot\theta)+g(\theta)$, e depois, como observa ser comum, com uma matriz de Coriolis: exatamente a forma acima. As notas *Underactuated Robotics*, de Tedrake, escrevem $M\ddot q+C\dot q=\tau_g(q)+Bu$, com a gravidade do lado direito, logo $\tau_g=-g$, e com uma matriz $B$ que leva entradas de controle a forças generalizadas. Confira o sinal do termo de gravidade antes de copiar fórmulas de uma para a outra.

Para o braço de dois elos, com $\beta=m_2L_1l_{c2}$ e $h(q)=-\beta\sin q_2$, os termos de velocidade da lição anterior são

$$C(q,\dot q)\,\dot q=\begin{pmatrix}h\,(2\dot q_1\dot q_2+\dot q_2^2)\\-h\,\dot q_1^2\end{pmatrix}.$$

*Modern Robotics* chama os termos em $\dot q_i^2$ de **centrípetos** e os termos em $\dot q_i\dot q_j$ com $i\ne j$ de **Coriolis**; as notas de Asada tratam os mesmos termos em $\dot q_i^2$ como efeitos **centrífugos**, o nome usado a seguir. Assim, a junta 1 sente um termo de Coriolis $2h\dot q_1\dot q_2$ e um termo centrífugo $h\dot q_2^2$ vindo da junta 2, e a junta 2 sente um termo centrífugo $-h\dot q_1^2$ vindo da junta 1.

### A matriz C é uma escolha

Só o vetor $C\dot q$ é fixado pela dinâmica. Qualquer matriz que o produza é válida. Duas escolhas para o braço de dois elos:

$$C=\begin{pmatrix}h\dot q_2&h(\dot q_1+\dot q_2)\\-h\dot q_1&0\end{pmatrix},\qquad C'=\begin{pmatrix}2h\dot q_2&h\dot q_2\\-h\dot q_1&0\end{pmatrix}.$$

Multiplicar qualquer uma por $\dot q$ dá o vetor acima. Uma terceira aparece impressa: as notas de Tedrake dão uma $C$ para o pêndulo duplo simples e observam que a escolha não era única.

A primeira é a **escolha de Christoffel**. Com os símbolos de Christoffel de primeira espécie

$$\Gamma_{ijk}(q)=\tfrac12\Big(\frac{\partial M_{ij}}{\partial q_k}+\frac{\partial M_{ik}}{\partial q_j}-\frac{\partial M_{jk}}{\partial q_i}\Big),\qquad C_{ij}=\sum_k\Gamma_{ijk}\,\dot q_k,$$

que é a Equação (8.19) de *Modern Robotics*. No braço de dois elos só $M_{11}$ e $M_{12}$ dependem de $q$, por meio de $q_2$, e o SymPy aplicado ao braço suposto ($\beta=0{,}2\ \text{kg m}^2$) devolve $C_{11}=-0{,}2\dot q_2s_2$, $C_{12}=-0{,}2(\dot q_1+\dot q_2)s_2$, $C_{21}=0{,}2\dot q_1s_2$, $C_{22}=0$, a matriz $C$ acima.

### Antissimetria, e a identidade mais fraca

**Proposição 8.1** de *Modern Robotics*: com $C$ definida por (8.19), $\dot M-2C$ é antissimétrica. No braço de dois elos, $\dot M=\begin{pmatrix}2h\dot q_2&h\dot q_2\\h\dot q_2&0\end{pmatrix}$, e

$$\dot M-2C=\begin{pmatrix}0&-h(2\dot q_1+\dot q_2)\\h(2\dot q_1+\dot q_2)&0\end{pmatrix},\qquad \dot M-2C'=\begin{pmatrix}-2h\dot q_2&-h\dot q_2\\h(2\dot q_1+\dot q_2)&0\end{pmatrix}.$$

A primeira é antissimétrica; a segunda tem diagonal não nula e não é. As notas de Tedrake também enunciam a propriedade só para uma escolha apropriada de $C$.

Uma afirmação mais fraca vale para toda $C$ válida. Derive a energia cinética e substitua a dinâmica:

$$\frac{d}{dt}\Big(\tfrac12\dot q^TM\dot q\Big)=\dot q^TM\ddot q+\tfrac12\dot q^T\dot M\dot q=\dot q^T(\tau-g)+\tfrac12\dot q^T\big(\dot M-2C\big)\dot q.$$

A taxa de variação da energia cinética tem de ser igual à potência dos torques que não são gravidade, $\dot q^T(\tau-g)$, então $\dot q^T(\dot M-2C)\dot q=0$ para toda $C$ que dê o $C\dot q$ certo. A antissimetria é a afirmação mais forte $x^T(\dot M-2C)x=0$ para todo vetor $x$. *Modern Robotics* usa a propriedade na Seção 11.4.2.2, para mostrar que o controle PD com compensação de gravidade leva o braço ao repouso no setpoint.

## Exemplos Resolvidos

### Exemplo 1: duas matrizes válidas num mesmo estado

Em $q=(30^\circ,45^\circ)$ e $\dot q=(1{,}0;\ -0{,}5)$ rad/s, $h=-0{,}14142$. Calculando $\dot M$ por uma diferença central de $M(q)$ ao longo de $\dot q$ (passo $10^{-6}$ s), sem usar a fórmula:

```text
C        = [[ 0.0707, -0.0707], [ 0.1414, 0.0000]]
C'       = [[ 0.1414,  0.0707], [ 0.1414, 0.0000]]
Mdot     = [[ 0.1414,  0.0707], [ 0.0707, 0.0000]]
Mdot-2C  = [[ 0.0000,  0.2121], [-0.2121, 0.0000]]
Mdot-2C' = [[-0.1414, -0.0707], [-0.2121, 0.0000]]
```

As duas dão $C\dot q=(0{,}1061;\ 0{,}1414)$ N m, os termos de velocidade do Exemplo 1 da lição anterior.

### Exemplo 2: a propriedade numa execução

Sorteie estados com `numpy.random.default_rng(7)`, $q$ uniforme em $[-\pi,\pi]^2$ e $\dot q$ uniforme em $[-2,2]^2$ rad/s, mais um vetor aleatório $x$ do `standard_normal(2)` do mesmo gerador, na ordem $q$, $\dot q$, $x$ para cada estado. De novo, $\dot M$ vem de uma diferença central:

```text
estado  max|S+S^T|, C   max|S+S^T|, C'   qdot'S qdot, C   qdot'S qdot, C'   x'S x, C    x'S x, C'
1       2.4e-10         0.529            6.8e-11          6.8e-11           5.4e-11     -0.174
2       1.2e-10         0.428            8.4e-11          8.4e-11           1.8e-11     -0.086
3       6.5e-11         0.058            -7.9e-14         -7.9e-14          4.5e-11     -0.051
```

Aqui $S=\dot M-2C$ para cada escolha, e os resíduos perto de $10^{-10}$ são o erro da diferença finita em $\dot M$. A $C$ de Christoffel passa nos dois testes. $C'$ passa na identidade de energia ao longo de $\dot q$ e falha na antissimetria para um $x$ qualquer.

A matriz de Tedrake para o pêndulo duplo, tomada como impressa, com massas pontuais $m_1=m_2=1$ e comprimentos $l_1=l_2=1$ (os ângulos dele são medidos a partir da vertical para baixo, o que muda a gravidade, mas não $M$ nem $C$), em $q=(0{,}3;\ 0{,}8)$ rad e $\dot q=(1{,}0;\ -0{,}5)$ rad/s, dá

$$\dot M-2C=\begin{pmatrix}0{,}7174&2{,}5107\\-0{,}7174&0{,}7174\end{pmatrix},\qquad \dot q^T(\dot M-2C)\dot q=3{,}7\times10^{-11}.$$

Seu $C\dot q=(0{,}538;\ 0{,}717)$ coincide com a forma de Christoffel do mesmo modelo, então a matriz é válida, satisfaz a identidade de energia e não é antissimétrica.

### Exemplo 3: um termo de cada vez

Todas as execuções usam o braço suposto da lição anterior, $g_0=0$ (movimento num plano horizontal) salvo indicação, e `scipy.integrate.solve_ivp` com `DOP853`, `rtol=1e-10`, `atol=1e-12`.

**Inércia: empurrar uma junta move a outra.** Em repouso em $q=(0,\ 90^\circ)$, aplique $\tau=(2,\ 0)$ N m. Então $M=\begin{pmatrix}0{,}8567&0{,}1067\\0{,}1067&0{,}1067\end{pmatrix}$ e $\ddot q(0)=M^{-1}\tau=(2{,}667;\ -2{,}667)\ \text{rad/s}^2$: a junta 2 acelera para trás sem torque próprio, porque a aceleração do elo 1 arrasta de lado a base do elo 2. Depois de 0,2 s, $q_2=86{,}79^\circ$. Com as entradas fora da diagonal de $M$ zeradas e o resto mantido, $q_2=89{,}92^\circ$.

**Centrífugo: girar a junta 1 abre o cotovelo.** Acione a junta 1 a $\dot q_1=3$ rad/s constante e deixe a junta 2 livre ($\tau_2=0$), partindo de $q_2=90^\circ$ em repouso. Com $\ddot q_1=0$, a junta 2 obedece $M_{22}\ddot q_2=h\dot q_1^2$, negativo para $q_2$ em $(0,\pi)$. O cotovelo se abre, passa pela posição reta $q_2=0$ em $t=0{,}451$ s e vai até $-90^\circ$ do outro lado, como um pêndulo cuja "gravidade" é o campo centrífugo. Sem os termos de velocidade, $q_2$ fica em $90^\circ$. Segurar o cotovelo em $90^\circ$ exige $\tau_2=\beta\sin q_2\,\dot q_1^2=0{,}2\cdot1\cdot9=1{,}8$ N m.

**Coriolis: dobrar o cotovelo acelera o ombro.** Acione a junta 2 de $30^\circ$ a $150^\circ$ com $\dot q_2=2$ rad/s (1,047 s) e deixe a junta 1 livre ($\tau_1=0$) com $\dot q_1(0)=1$ rad/s. Enquanto o cotovelo dobra, $M_{11}$ cai de 1,203 para 0,510 $\text{kg m}^2$. Como $M$ não depende de $q_1$ e $\tau_1=0$, o momento $p_1=(M\dot q)_1$, que é o momento angular em torno da junta 1, tem de se conservar:

```text
termos de velocidade em tau_1   qdot_1 no fim (rad/s)   p_1 inicio   p_1 fim
ambos (modelo completo)         3.716                   1.7628       1.7628
so Coriolis 2h qd1 qd2          2.358                   1.7628       1.0700
so centrifugo h qd2^2           1.858                   1.7628       0.8148
nenhum                          1.000                   1.7628       0.3772
```

Só o modelo completo conserva $p_1$. É o efeito que *Modern Robotics* compara a uma patinadora que recolhe os braços durante um giro. Nenhuma parte sozinha conserva $p_1$: só a parte de Coriolis dá cerca de metade da aceleração do ombro, só a centrífuga cerca de um terço, e as duas não se somam simplesmente, porque cada uma muda $\dot q_1$ e, com ele, a outra.

**Gravidade: o que precisa ser sustentado.** Agora $g_0=9{,}81\ \text{m/s}^2$, em repouso com o braço horizontal, $q=(0,0)$. Com $\tau=0$, o braço parte com $\ddot q=(-26{,}16;\ 38{,}42)\ \text{rad/s}^2$ e depois de 0,2 s está em $(-27{,}99^\circ;\ 35{,}31^\circ)$. Com $\tau=g(q)$, que vale $(21{,}09;\ 3{,}92)$ N m nessa pose, o braço simulado fica em $(0,0)$ por 2 s, com velocidade zero.

### Exemplo 4: como os termos escalam com a velocidade

Mova de $(-60^\circ,30^\circ)$ a $(60^\circ,120^\circ)$ ao longo de $q(t)=q_a+(q_b-q_a)\tfrac12\big(1-\cos(\pi t/T)\big)$, com gravidade, e avalie cada termo ao longo do caminho (2001 amostras). Picos de módulo em N m:

```text
duracao T    |M qdd| j1, j2    |C qd| j1, j2    |g| j1, j2      |tau| j1, j2
1.0 s        14.60,  3.72      4.35,  2.11      19.18,  3.92    26.59,  7.21
0.5 s        58.42, 14.88      17.39,  8.43     19.18,  3.92    70.40, 18.28
```

Reduzir a duração à metade dobra toda velocidade e quadruplica toda aceleração, então os termos de inércia e de velocidade crescem exatamente 4 vezes, enquanto a gravidade, que só depende de $q$, não muda. Neste movimento, a gravidade é o maior termo com $T=1$ s e a inércia é o maior com $T=0{,}5$ s, e os termos de velocidade crescem com o quadrado da velocidade.

## Equívocos Comuns e Armadilhas

- **"$C$ é uma matriz única."** Só $C\dot q$ é único. O Exemplo 1 teve duas matrizes válidas, e as notas de Tedrake imprimem uma terceira.
- **"$\dot M-2C$ é sempre antissimétrica."** Só na escolha de Christoffel (ou em outra escolha construída para ter a propriedade). $C'$ e a matriz de Tedrake falham no Exemplo 2.
- **"$\dot q^T(\dot M-2C)\dot q=0$ prova a antissimetria."** Isso vale para toda $C$ válida, porque é balanço de energia.
- **"Efeitos de Coriolis e centrífugos são fictícios, então não custam nada."** Em coordenadas de junta, são exigências reais de torque: 1,8 N m para segurar o cotovelo no Exemplo 3.
- **"Os termos fora da diagonal de $M$ são pequenos demais para importar."** Um torque só na junta 1 acelerou a junta 2 a $-2{,}67\ \text{rad/s}^2$.
- **"A gravidade é o termo grande."** Só em baixa velocidade. No Exemplo 4, reduzir a duração à metade deixou o termo de inércia na junta 1 com três vezes o tamanho do termo de gravidade.
- **"Os sinais são padronizados."** Algumas fontes põem a gravidade do lado direito como $\tau_g=-g$.

## Resumo

A equação do manipulador $M\ddot q+C\dot q+g=\tau$ põe a dinâmica numa forma padrão em que $M$, $g$ e o vetor $C\dot q$ são fixos, mas a matriz $C$ não é. A escolha de Christoffel, $C_{ij}=\sum_k\Gamma_{ijk}\dot q_k$, torna $\dot M-2C$ antissimétrica, como as execuções confirmaram até o erro de diferença finita de $10^{-10}$, enquanto uma $C'$ igualmente válida e a $C$ impressa nas notas de Tedrake não tornam. Toda $C$ válida satisfaz $\dot q^T(\dot M-2C)\dot q=0$, que é balanço de energia. Simulados um de cada vez, o acoplamento de inércia moveu uma junta sem torque, o termo centrífugo abriu um cotovelo livre enquanto a junta 1 girava, os termos de velocidade aceleraram o ombro de 1,0 para 3,7 rad/s quando o cotovelo dobrou, conservando o momento angular, o que nem a parte de Coriolis nem a centrífuga fizeram sozinhas, e a gravidade foi cancelada exatamente por $\tau=g(q)$. Reduzir à metade a duração de um movimento multiplicou por 4 os termos de inércia e de velocidade e deixou a gravidade igual.

## Documentation Links

- [Modern Robotics, Lynch and Park (2017 preprint PDF)](https://hades.mech.northwestern.edu/images/7/7f/MR.pdf): a Seção 8.1 nomeia os termos centrípetos e de Coriolis, define os símbolos de Christoffel e a matriz de Coriolis (8.19) e prova a Proposição 8.1; a Seção 11.4.2.2 a usa num argumento de estabilidade.
- [Underactuated Robotics, Tedrake, Multi-Body Dynamics](https://underactuated.mit.edu/multibody.html): as equações do manipulador com a gravidade do lado direito, o exemplo do pêndulo duplo com uma $C$ não única e a propriedade de antissimetria para uma $C$ apropriada.
- [MIT OCW 2.12 Introduction to Robotics, Asada, Chapter 7: Dynamics](https://ocw.mit.edu/courses/2-12-introduction-to-robotics-fall-2005/resources/chapter7/): uma interpretação física de cada termo das equações de dois elos, incluindo os efeitos centrífugo e de Coriolis.
- [SciPy, scipy.integrate.solve_ivp](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.solve_ivp.html): o integrador usado nas simulações de um termo de cada vez.
