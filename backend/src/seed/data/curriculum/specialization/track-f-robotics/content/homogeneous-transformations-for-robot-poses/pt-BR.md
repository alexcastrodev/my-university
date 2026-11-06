---
version: 1.0
updatedAt: 2026-11-04
title: "Transformações Homogêneas para Poses de Robôs"
summary: "A transformação homogênea 4x4 como pose de um corpo rígido, sua composição ao longo de uma cadeia cinemática e sua inversa, levando a ideia da lição de computação gráfica para os referenciais de um robô."
---
## Objetivos de Aprendizagem

- Juntar uma orientação e uma posição numa transformação $4\times4$ $T_{ab}$ e lê-la como a pose do referencial $\{b\}$ no referencial $\{a\}$.
- Compor poses ao longo de uma cadeia de referenciais cancelando índices, e reconhecer uma cadeia multiplicada na ordem errada.
- Inverter uma pose com $R^T$ e $-R^Tp$, sem inversa geral de matriz, e explicar por que o atalho falha quando a matriz tem escala.
- Distinguir deslocar um referencial ao longo de eixos fixos (pré-multiplicação) de deslocá-lo ao longo dos próprios eixos (pós-multiplicação).
- Detectar e reparar a perda de ortonormalidade que produtos longos acumulam em ponto flutuante.

## Contexto e Motivação

`homogeneous-coordinates-and-2d-affine-transformations` acrescentou um 1 a cada ponto para que a translação virasse produto de matrizes, usou 0 para direções, que assim ignoram a translação, e mostrou que a ordem de uma composição muda o resultado. `3d-transformations-and-composing-the-model-matrix` levou isso para matrizes $4\times4$, com escala inclusive. Esses fatos ficam assumidos aqui.

A robótica usa as mesmas matrizes com duas mudanças. O bloco superior esquerdo fica restrito a uma rotação (sem escala, sem cisalhamento), o que torna a inversa exata e quase de graça. E há muitos referenciais ao mesmo tempo: a base do robô, uma câmera, um objeto detectado, uma garra, cada elo do braço. Toda transformação carrega, portanto, dois índices, e a maior parte dos bugs vem de lê-los ao contrário. O objetivo é uma notação em que um produto errado pareça errado antes de ser executado.

## Teoria Central

### Uma pose como matriz 4x4

Com as convenções de `rotation-matrices-and-rigid-body-orientation` (vetores coluna, $R_{ab}$ guardando os eixos de $\{b\}$ escritos em $\{a\}$), a pose de $\{b\}$ em $\{a\}$ é

$$T_{ab}=\begin{pmatrix}R_{ab}&p_{ab}\\0&1\end{pmatrix},$$

em que $p_{ab}$ é a origem de $\{b\}$ escrita em $\{a\}$. Essas matrizes formam o grupo especial euclidiano $SE(3)$, os movimentos de corpo rígido. Agindo sobre um ponto com coordenada homogênea 1, $T_{ab}$ converte coordenadas em $\{b\}$ em coordenadas em $\{a\}$:

$$p_a=R_{ab}p_b+p_{ab}.$$

Então $T_{ab}$ tem duas leituras, como as rotações tinham: a pose de $\{b\}$ vista de $\{a\}$, que leva o referencial $\{a\}$ até o referencial $\{b\}$, e o conversor que leva coordenadas de $\{b\}$ para $\{a\}$. As palavras "de" e "para" trocam de lugar entre as duas leituras. A documentação do tf2 do ROS 2 alerta justamente para isso: transformar um referencial e transformar dados representados nele são, nas palavras dela, "directly inverse", e as transformações que o tf2 publica usam a formulação de referencial.

### Composição ao longo de uma cadeia

Se $\{b\}$ é conhecido em $\{a\}$ e $\{c\}$ em $\{b\}$, então

$$T_{ac}=T_{ab}T_{bc}=\begin{pmatrix}R_{ab}R_{bc}&R_{ab}p_{bc}+p_{ab}\\0&1\end{pmatrix}.$$

Os índices internos se cancelam, $T_{ab}T_{bc}=T_{ac}$, e o produto de dois movimentos rígidos continua rígido. A parte de posição mostra por que a ordem importa: $p_{bc}$ é girado para $\{a\}$ antes de $p_{ab}$ ser somado. Uma cadeia $T_{ab}T_{bc}T_{cd}\cdots$ só é legítima quando cada segundo índice é igual ao primeiro índice seguinte; qualquer outro produto é uma matriz sem significado, mesmo com o formato certo.

### A inversa sem inversa geral

Resolver $p_a=Rp_b+p$ para $p_b$ só exige $R^{-1}=R^T$:

$$p_b=R^Tp_a-R^Tp,\qquad T^{-1}=\begin{pmatrix}R^T&-R^Tp\\0&1\end{pmatrix},\qquad T_{ba}=T_{ab}^{-1}.$$

O custo é uma transposição (nenhuma conta) e um produto matriz-vetor $3\times3$, e o resultado é exato a menos do arredondamento desse produto. Dois atalhos parecidos estão errados. Transpor a matriz $4\times4$ inteira joga $p$ para a última linha. Usar $-p$ como nova translação esquece que $p$ está escrito em $\{a\}$ e a inversa precisa dele em $\{b\}$. A fórmula também depende de $R^TR=I$: uma model matrix de computação gráfica $M=TRS$ com escala tem um bloco superior esquerdo que não é ortogonal, e aí só a inversa geral funciona.

### Deslocando um referencial: eixos fixos ou eixos do corpo

Seja $T=(R,p)$ um deslocamento. Como nas rotações, o lado em que ele multiplica decide a que referencial pertencem o eixo e o deslocamento (*Modern Robotics*, Seção 3.3.1):

$$T_{sb'}=T\,T_{sb}=\begin{pmatrix}RR_{sb}&Rp_{sb}+p\\0&1\end{pmatrix},\qquad T_{sb''}=T_{sb}\,T=\begin{pmatrix}R_{sb}R&R_{sb}p+p_{sb}\\0&1\end{pmatrix}.$$

Pré-multiplicar gira $\{b\}$ em torno de um eixo do referencial fixo (a origem dele gira em volta do eixo fixo) e depois translada por $p$ em coordenadas fixas. Pós-multiplicar translada por $p$ ao longo dos eixos do próprio corpo e depois gira em torno do novo eixo do corpo, o que deixa a nova origem no lugar.

### Mantendo R uma rotação

Todo produto arredonda, e uma pose atualizada por muitos incrementos pequenos, como ao integrar um giroscópio ou acumular odometria, se afasta de $SO(3)$. O reparo é trocar $R$ por $UV^T$ da sua decomposição em valores singulares $R=U\Sigma V^T$, o que devolve os valores singulares a 1. A verificação é barata: $\lVert R^TR-I\rVert$ e $\det R$.

## Exemplos Resolvidos

Todos os comprimentos estão em metros, e os valores são supostos, para ilustrar.

### Exemplo 1: onde está o objeto, no referencial da base do robô?

Uma câmera $\{c\}$ está montada 1,2 m acima da origem da base e 0,5 m ao longo de $\hat x_s$, olhando para baixo: $R_{sc}=R_x(180°)$, então $\hat z_c$ aponta para baixo. Um detector informa um objeto $\{o\}$ em $(0{,}1;\ -0{,}05;\ 0{,}9)$ nas coordenadas da câmera, com $R_{co}=R_x(180°)R_z(30°)$. Então

$$T_{sc}=\begin{pmatrix}1&0&0&0{,}5\\0&-1&0&0\\0&0&-1&1{,}2\\0&0&0&1\end{pmatrix},\quad T_{co}=\begin{pmatrix}0{,}866&-0{,}5&0&0{,}1\\-0{,}5&-0{,}866&0&-0{,}05\\0&0&-1&0{,}9\\0&0&0&1\end{pmatrix},$$

$$T_{so}=T_{sc}T_{co}=\begin{pmatrix}0{,}866&-0{,}5&0&0{,}6\\0{,}5&0{,}866&0&0{,}05\\0&0&1&0{,}3\\0&0&0&1\end{pmatrix}.$$

O objeto está em $(0{,}6;\ 0{,}05;\ 0{,}3)$, girado $30°$ em torno da vertical, com $\hat z_o$ para cima. A conferência é física: 0,9 m abaixo de uma câmera a 1,2 m dá altura de 0,3 m. Multiplicar na ordem errada, $T_{co}T_{sc}$, dá uma transformação rígida válida com translação $(0{,}533;\ -0{,}3;\ -0{,}3)$, abaixo do plano da base. Os índices ($co$ e depois $sc$, com $o\neq s$) denunciam o erro antes de qualquer conta.

### Exemplo 2: invertendo poses

Pela fórmula, $T_{cs}=T_{sc}^{-1}$ tem rotação $R_x(180°)$ e translação $(-0{,}5;\ 0;\ 1{,}2)$: vista da câmera, a origem da base está 1,2 m bem à frente, ao longo de $\hat z_c$, e 0,5 m ao longo de $-\hat x_c$. Ela concorda com `numpy.linalg.inv` até $0$ em float64, e $T_{cs}T_{sc}=I$ exatamente.

Para o objeto, $T_{os}=T_{so}^{-1}$ tem rotação $R_z(-30°)$ e translação $-R_{so}^Tp_{so}=(-0{,}5446;\ 0{,}2567;\ -0{,}3)$. Inverter cada fator e inverter a ordem dá a mesma matriz, $T_{oc}T_{cs}$, até $5{,}6\times10^{-17}$, e `numpy.linalg.inv` concorda até $1{,}1\times10^{-16}$. Os dois atalhos errados, aplicados a $T_{so}$:

```text
naive 4x4 transpose, times T_so        "-p" shortcut, times T_so
[ 1       0       0       0.5446]      [ 1  0  0  -0.0554]
[ 0       1       0      -0.2567]      [ 0  1  0  -0.3067]
[ 0       0       1       0.3   ]      [ 0  0  1   0     ]
[ 0.5446 -0.2567  0.3     1.4525]      [ 0  0  0   1     ]
```

Nenhum dos produtos é a identidade. O segundo é o mais perigoso, porque mantém o formato de uma pose: a rotação está certa e a posição erra por 31 cm.

### Exemplo 3: uma pegada ao longo da cadeia

Uma pose de pré-pegada põe a garra $\{g\}$ 10 cm acima do objeto ao longo de $\hat z_o$, com o eixo de aproximação $\hat z_g$ apontando para baixo: $T_{og}=\big(R_x(180°),\,(0;\ 0;\ 0{,}10)\big)$. Então

$$T_{sg}=T_{so}T_{og}=\begin{pmatrix}0{,}866&0{,}5&0&0{,}6\\0{,}5&-0{,}866&0&0{,}05\\0&0&-1&0{,}4\\0&0&0&1\end{pmatrix},$$

a garra a 0,4 m de altura, apontando para baixo. Um canto do objeto em $(0{,}02;\ 0{,}03;\ 0)$ em $\{o\}$ fica em $(0{,}6023;\ 0{,}0860;\ 0{,}3)$ em $\{s\}$ e em $(0{,}02;\ -0{,}03;\ 0{,}1)$ em $\{g\}$. Este último valor sai igual calculado como $T_{og}^{-1}$ aplicado em $\{o\}$ ou como $T_{sg}^{-1}T_{so}$ aplicado em $\{o\}$, que é a regra da cadeia $T_{gs}T_{so}=T_{go}$ conferida numericamente.

### Exemplo 4: o mesmo deslocamento de cada lado

Sejam $T_{sb}=\big(R_x(90°),\,(1,0,0)\big)$ e o deslocamento $D=\big(R_z(90°),\,(0;\ 0;\ 0{,}3)\big)$:

$$D\,T_{sb}=\begin{pmatrix}0&0&1&0\\1&0&0&1\\0&1&0&0{,}3\\0&0&0&1\end{pmatrix},\qquad T_{sb}D=\begin{pmatrix}0&-1&0&1\\0&0&-1&-0{,}3\\1&0&0&0\\0&0&0&1\end{pmatrix}.$$

Em $DT_{sb}$ a origem $(1,0,0)$ gira em torno do $\hat z_s$ fixo até $(0,1,0)$ e sobe 0,3 m ao longo de $\hat z_s$. Em $T_{sb}D$ a origem anda 0,3 m ao longo do $\hat z_b$ do corpo, que aponta para $-\hat y_s$, até $(1;\ -0{,}3;\ 0)$, e o referencial gira em torno de $\hat z_b$ sem sair do lugar. Mesmo $D$, referenciais diferentes, resultados diferentes.

### Exemplo 5: onde o atalho quebra, e onde o arredondamento quebra R

Tome $M=\operatorname{Trans}(1,0,0)\,R_z(90°)\,\operatorname{diag}(2,2,2,1)$, uma model matrix com escala. Montar "$[R^T,-R^Tp]$" a partir dos blocos e multiplicar por $M$ dá $\operatorname{diag}(4,4,4,1)$, não $I$; o bloco não é ortogonal ($\lVert R^TR-I\rVert_{\max}=3$).

Agora componha $R\leftarrow R\,R_z(0{,}001)R_x(0{,}002)$ um milhão de vezes, a partir de $I$:

```text
precision   max|R^T R - I| after 1e3   after 1e5   after 1e6   det after 1e6
float32     2.5e-05                    1.9e-03     2.0e-02     0.9946
float64     7.4e-14                    7.6e-12     7.6e-11     1.0000000000 (error 7.6e-11)
```

Em float32 a "rotação" encolhe volumes em meio por cento, e a inversa por $R^T$ erra por cerca de 2%. Trocar $R$ por $UV^T$ da SVD traz o erro de volta para menos de $7\times10^{-16}$ nos dois casos. Em float64 o erro cresce de forma aproximadamente linear com o número de produtos, então um estimador de longa duração em float64 ainda precisa do reparo, só que com menos frequência.

## Equívocos Comuns e Armadilhas

- **"A inversa de uma pose é a transposta."** Só o bloco de rotação é transposto. O Exemplo 2 mostra a transposta da matriz inteira falhando.
- **"Inverter uma pose troca o sinal da posição."** A nova posição é $-R^Tp$, não $-p$; o erro no Exemplo 2 foi de 31 cm.
- **"$T_{ab}$ leva pontos de $\{a\}$ para $\{b\}$."** Ela leva coordenadas em $b$ para coordenadas em $a$. Leia os índices da direita para a esquerda.
- **"Toda transformação $4\times4$ se inverte com o atalho."** Só as rígidas. A matriz com escala do Exemplo 5 devolveu $4I$.
- **"Se cada fator está certo, o produto está certo."** O produto invertido do Exemplo 1 era uma transformação rígida válida que punha o objeto abaixo da mesa.
- **"Matrizes de rotação continuam rotações."** Em ponto flutuante elas derivam: $2\times10^{-2}$ depois de um milhão de produtos em float32 no Exemplo 5.

## Resumo

Uma transformação homogênea $T_{ab}=(R_{ab},p_{ab})$ é a pose de $\{b\}$ em $\{a\}$ e o conversor de coordenadas em $b$ para coordenadas em $a$. Poses se compõem ao longo de uma cadeia cancelando os índices internos, $T_{ac}=T_{ab}T_{bc}$, e um produto cujos índices não se cancelam está errado mesmo sendo uma matriz válida. Como $R$ é ortogonal, a inversa é $(R^T,-R^Tp)$, exata e barata; a transposta da matriz inteira e o atalho $-p$ estão errados, e a fórmula falha para matrizes com escala. Um deslocamento aplicado à esquerda usa eixos fixos, e à direita usa eixos do corpo. Produtos longos se afastam de $SO(3)$, de forma mensurável em float32, e uma SVD restaura a rotação.

## Documentation Links

- [Modern Robotics, book page (Lynch and Park)](https://hades.mech.northwestern.edu/index.php/Modern_Robotics): o livro-texto gratuito e os vídeos.
- [Modern Robotics, preprint PDF](https://hades.mech.northwestern.edu/images/7/7f/MR.pdf): a Seção 3.3.1 sobre $SE(3)$, a fórmula da inversa, o cancelamento de índices e o deslocamento no referencial fixo versus no do corpo.
- [ROS 2 Jazzy documentation, tf2](https://docs.ros.org/en/jazzy/Concepts/Intermediate/About-Tf2.html): uma árvore de transformações na prática, e o alerta de que transformações de referencial e de dados são inversas.
- [NumPy, numpy.linalg.svd](https://numpy.org/doc/stable/reference/generated/numpy.linalg.svd.html): a decomposição usada para reortonormalizar uma rotação que derivou.
- [NumPy, numpy.linalg.inv](https://numpy.org/doc/stable/reference/generated/numpy.linalg.inv.html): a inversa geral contra a qual a fórmula fechada é conferida.
