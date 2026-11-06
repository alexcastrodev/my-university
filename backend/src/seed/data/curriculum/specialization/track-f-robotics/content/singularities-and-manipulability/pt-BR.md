---
version: 1.0
updatedAt: 2026-11-04
title: "Singularidades e Manipulabilidade"
summary: "Onde o Jacobiano perde posto, o que uma singularidade faz com as velocidades das juntas e a medida de manipulabilidade de Yoshikawa."
---
## Objetivos de Aprendizagem

- Definir uma singularidade cinemática como perda de posto do Jacobiano, e testá-la pelo determinante quando $J$ é quadrada e pelos valores singulares nos outros casos.
- Encontrar as configurações singulares de um braço planar de dois elos e de um braço articulado de três juntas, e classificá-las como de borda ou interiores.
- Mostrar com uma execução como as velocidades de junta crescem perto de uma singularidade, e prever seu tamanho pelo menor valor singular.
- Definir a medida de manipulabilidade de Yoshikawa, calculá-la para Jacobianos quadrados, largos e altos, e dizer o que ela não captura.
- Descrever o que os mínimos quadrados amortecidos ganham e quanto custam.

## Contexto e Motivação

`velocity-kinematics-and-the-jacobian` montou a matriz que transforma taxas de junta em velocidade da ferramenta, $\dot{\mathbf x}=J(\mathbf q)\dot{\mathbf q}$. Um controlador costuma precisar do sentido oposto: a tarefa diz como a ferramenta deve se mover, e o controlador calcula as taxas de junta, para $J$ quadrada e invertível por $\dot{\mathbf q}=J^{-1}\dot{\mathbf x}$. `inverse-kinematics-and-workspace` já encontrou o ponto problemático pelo lado da iteração: com o braço esticado, $\det J=0$ e o método de Newton não conseguia dar um passo. Esta lição olha as mesmas configurações pelo lado da velocidade. O que exatamente se perde ali, quão grandes ficam as taxas de junta nas vizinhanças, e como medir "vizinhança" com um único número?

## Teoria Central

### Singular quer dizer deficiente em posto

Seja $J$ de dimensão $m\times n$, levando $n$ taxas de junta a $m$ velocidades da tarefa. Uma configuração é **singular** quando $\operatorname{rank}J(\mathbf q)$ cai abaixo do seu maior valor entre todas as configurações, que é $\min(m,n)$ para um braço que não é deficiente em toda parte. Nesse ponto acontecem duas coisas juntas. Alguma direção da tarefa sai da imagem de $J$, então nenhum movimento de junta produz movimento da ferramenta naquela direção. E o núcleo cresce, então algum movimento de junta não produz movimento da ferramenta.

Para $J$ quadrada, perder posto é ter $\det J=0$. Para $J$ não quadrada não existe determinante, e a ferramenta geral é a decomposição em valores singulares $J=U\Sigma V^T$, com $\sigma_1\ge\dots\ge\sigma_{\min(m,n)}\ge0$. O posto é o número de $\sigma_i$ não nulos, e o menor deles diz quão perto a configuração está de perder uma direção. Em ponto flutuante, "zero" quer dizer "abaixo de uma tolerância", que é o que `numpy.linalg.matrix_rank` aplica.

### O que acontece perto de uma singularidade

Perto de uma singularidade de uma $J$ quadrada, mas não nela, $J^{-1}$ existe e

$$\lVert\dot{\mathbf q}\rVert=\lVert J^{-1}\dot{\mathbf x}\rVert\le\frac{\lVert\dot{\mathbf x}\rVert}{\sigma_{\min}},$$

com igualdade quando $\dot{\mathbf x}$ aponta ao longo do vetor singular à esquerda de $\sigma_{\min}$. Então as taxas de junta não explodem para toda velocidade da tarefa: só a componente na direção que está sendo perdida é amplificada, por $1/\sigma_{\min}$. Velocidades da tarefa que ficam nas direções sobreviventes continuam baratas.

### Dois braços e seus conjuntos singulares

No braço planar de dois elos, $\det J=L_1L_2\sin\theta_2$: singular com o braço esticado ($\theta_2=0$) ou dobrado ($\theta_2=\pi$). Os dois casos ficam na borda do espaço de trabalho, onde `inverse-kinematics-and-workspace` encontrou uma única solução em vez de duas.

No braço articulado de `the-denavit-hartenberg-convention`, com Jacobiano de posição $J_v$ ($3\times3$),

$$\det J_v=-a_2a_3\sin\theta_3\,\big(a_2\cos\theta_2+a_3\cos(\theta_2+\theta_3)\big)=-a_2a_3\sin\theta_3\;r,$$

em que $r$ é a distância horizontal da ponta ao eixo da base. O fator $\sin\theta_3$ é a **singularidade de cotovelo**, antebraço esticado ou dobrado, de novo na borda. O fator $r$ é a **singularidade de ombro**: a ponta sobre o eixo vertical da junta 1. Essa fica no interior do espaço de trabalho, então uma tarefa em linha reta pode atravessá-la.

### A medida de manipulabilidade de Yoshikawa

Uma bola unitária de taxas de junta, $\lVert\dot{\mathbf q}\rVert\le1$, é levada por $J$ a um elipsoide de velocidades da tarefa com semieixos $\sigma_i$ ao longo dos vetores singulares à esquerda. O Modern Robotics o chama de elipsoide de manipulabilidade e, para um espaço da tarefa de dimensão $m\le n$, mede seu volume com

$$w(\mathbf q)=\sqrt{\det\big(J(\mathbf q)\,J(\mathbf q)^T\big)}=\sigma_1\sigma_2\cdots\sigma_m,$$

que ele lista como $\mu_3$ e diz ser proporcional ao volume do elipsoide. As notas do capítulo atribuem a Yoshikawa (1985, *International Journal of Robotics Research*) a primeira formulação quantitativa de manipulabilidade, e a Robotics Toolbox for Python implementa esse volume como seu método padrão `"yoshikawa"`, descrito como "distance from singularity". Propriedades que saem da definição:

- $w\ge0$, e $w=0$ exatamente numa singularidade.
- Para $J$ quadrada, $w=\lvert\det J\rvert$.
- Para $J$ larga ($m<n$, um braço redundante), $JJ^T$ é $m\times m$ e a fórmula funciona como está.
- Para $J$ alta ($m>n$), $JJ^T$ é $m\times m$ com posto no máximo $n<m$, então $w=0$ em toda configuração e a fórmula não informa nada. A saída usual é aplicá-la às linhas que importam para a tarefa, por exemplo só $J_v$. O Modern Robotics separa os elipsoides linear e angular por um motivo relacionado: as unidades diferem. A Robotics Toolbox oferece a mesma escolha pelo argumento `axes` e avisa que usar todas as linhas "involves adding different units".
- $w$ tem unidade (m² para um Jacobiano de posição planar), então seu valor muda com a unidade de comprimento, e comparar $w$ entre robôs de tamanhos diferentes compara tamanho tanto quanto destreza.

Outras medidas de um número olham a forma em vez do volume. O Modern Robotics usa $\mu_1=\sigma_{\max}/\sigma_{\min}$, que vale 1 para um elipsoide redondo e cresce perto de uma singularidade. Murray, Li e Sastry listam $\sigma_{\min}$ e $\sigma_{\min}/\sigma_{\max}$, e avisam que o determinante pode ser grande mesmo com $\sigma_{\min}$ pequeno, porque um $\sigma_{\max}$ grande compensa. Os dois livros usam os símbolos $\mu_1$, $\mu_2$, $\mu_3$ para quantidades diferentes.

## Exemplos Resolvidos

Valores supostos: braço de dois elos com $L_1=1{,}0$ m e $L_2=0{,}6$ m; braço articulado com $d_1=0{,}4$ m, $a_2=0{,}5$ m e $a_3=0{,}4$ m. Velocidades em m/s, taxas de junta em rad/s.

### Exemplo 1: aproximando-se do braço esticado

Mova a ponta do braço de dois elos radialmente para fora ao longo do eixo $x$ a $0{,}05$ m/s, rumo à borda em $r=1{,}6$ m, e compare com a mesma velocidade na direção tangencial. Taxas de junta por $\dot{\mathbf q}=J^{-1}\dot{\mathbf x}$ no ramo $\theta_2>0$:

```text
r (m)      theta2 (graus)   sigma_min   |qdot| radial   |qdot| tangencial
1.0        107.46           0.559       0.089           0.050
1.5        42.13            0.252       0.198           0.033
1.59       13.24            0.081       0.618           0.031
1.599      4.18             0.026       1.95            0.031
1.5999     1.32             0.0081      6.17            0.031
1.59999    0.42             0.0026      19.5            0.031
```

Cada passo dez vezes mais perto da borda multiplica a taxa radial por cerca de $\sqrt{10}$. Derivar $r^2=L_1^2+L_2^2+2L_1L_2\cos\theta_2$ explica: $\dot\theta_2=-r\dot r/(L_1L_2\sin\theta_2)$, que dá $-1{,}826$ rad/s em $r=1{,}599$, e $\sin\theta_2$ encolhe como a raiz quadrada da distância até a borda. A taxa tangencial, enquanto isso, se acomoda em $0{,}05/1{,}6=0{,}031$ rad/s: andar ao longo do círculo da borda só exige a junta 1, e essa direção nunca se perde.

### Exemplo 2: uma linha reta passando pela singularidade de ombro

Comande a ponta do braço articulado ao longo da reta $\mathbf p(t)=(-0{,}2+0{,}1t;\ h;\ 0{,}6)$ m para $0\le t\le4$ s, a $0{,}1$ m/s constantes em $x$, passando a uma distância horizontal $h$ do eixo da base em $t=2$ s. A execução integra $\dot{\mathbf q}=J_v^{-1}\dot{\mathbf p}$ pelo método de Runge-Kutta clássico de quarta ordem com passo fixo $\Delta t$, partindo da cinemática inversa exata no ramo $\theta_3<0$.

```text
h (m)    pico |theta1_dot|   em t (s)   min |det Jv|   erro máx. de seguimento (dt = 1e-3 ou 1e-4 s)
0.05     2.000               2.000      3.9e-03        abaixo de 1e-12 m
0.01     10.000              2.000      7.6e-04        abaixo de 1e-12 m
0.001    100.00              2.000      7.6e-05        abaixo de 1e-9 m
```

O pico é exatamente $v/h$. A junta 1 é a guinada da base, $\theta_1=\operatorname{atan2}(y,x)$, então $\dot\theta_1=(x\dot y-y\dot x)/(x^2+y^2)$, que em $x=0$ vale $-v/h$. Nesse instante as outras duas juntas estão paradas: $\dot{\mathbf q}=(-10,0,0)$ para $h=0{,}01$. Na passagem inteira $\theta_1$ vai de $177{,}1^\circ$ a $2{,}9^\circ$, e $157^\circ$ disso acontecem enquanto a ponta percorre os $10h$ em volta do eixo. Para $h=1$ mm são $157^\circ$ em $0{,}1$ s, com a ferramenta andando a só $0{,}1$ m/s. A integração não é o problema: o erro de seguimento fica perto do nível do arredondamento, cujos dígitos exatos dependem da implementação. O problema é o motor. Se a junta da base for limitada a, digamos, 3 rad/s (valor suposto), essa trajetória é inviável para $h<0{,}033$ m.

### Exemplo 3: mínimos quadrados amortecidos, e o preço

Os mínimos quadrados amortecidos trocam $J^{-1}$ por $J^T(JJ^T+\lambda^2I)^{-1}$. Em valores singulares, cada ganho $1/\sigma_i$ vira $\sigma_i/(\sigma_i^2+\lambda^2)$, que é no máximo $1/(2\lambda)$, então as taxas de junta ficam limitadas. O preço é que a velocidade comandada da ferramenta deixa de ser cumprida exatamente. Refaça o Exemplo 2 com $h=1$ mm, $\Delta t=10^{-4}$ s e realimentação de posição, $\dot{\mathbf q}=J^T(JJ^T+\lambda^2I)^{-1}(\dot{\mathbf p}_d+K\mathbf e)$ com $K=10\ \text{s}^{-1}$:

```text
lambda (m)   taxa de junta de pico (rad/s)   erro máx. de seguimento (mm)   theta final (graus)
0            100.0                           < 0.001                        (0.3, 98.1, -145.6)
0.001        50.3                            2.2                            (0.3, 98.1, -145.6)
0.003        7.0                             1.75                           (180.3, 188.1, -145.6)
0.01         1.12                            1.58                           (180.3, 188.1, -145.6)
0.03         0.51                            1.53                           (180.3, 188.1, -145.6)
```

A taxa de junta de pico é a maior taxa de uma única junta; a norma de $\dot{\mathbf q}$ no pico concorda com ela a menos de 0,02 rad/s nas três primeiras linhas e vale $1{,}23$ e $0{,}57$ rad/s nas duas últimas. Um amortecimento de 1 cm corta o pico da junta mais rápida por um fator de 90, ao custo de um desvio de 1,6 mm perto do eixo, e a realimentação traz o erro de volta a $0{,}011$ mm no fim. A última coluna mostra um efeito colateral. Sem amortecimento suficiente, a base gira cerca de $177^\circ$. Com $\lambda\ge3$ mm o braço passa por cima do eixo da base, com $\theta_2$ ultrapassando $180^\circ$, e termina no outro ramo de ombro, com a mesma posição da ferramenta. Se isso é aceitável depende dos limites de junta e do que está em volta do robô.

### Exemplo 4: manipulabilidade do braço de dois elos

```text
theta2 (graus)   w (m^2)   sigma_1   sigma_2   mu1 = sigma_1/sigma_2
90               0.600     1.215     0.494     2.46
120              0.520     0.877     0.593     1.48
135              0.424     0.732     0.580     1.26
45               0.424     1.580     0.269     5.88
10               0.104     1.702     0.061     27.8
1                0.0105    1.709     0.0061    279
```

Aqui $w=\lvert\det J\rvert=0{,}6\lvert\sin\theta_2\rvert$, que não depende de $\theta_1$ (em $\theta_2=60^\circ$ vale $0{,}5196$ tanto com $\theta_1=0$ quanto com $\theta_1=1$ rad) e é máximo em $\theta_2=\pm90^\circ$. Mas a elipse mais redonda está em outro lugar: uma varredura de $\theta_2$ põe o mínimo $\mu_1=1{,}260$ em $\theta_2\approx134{,}2^\circ$, onde $w$ é cerca de 28 por cento menor. E $\theta_2=45^\circ$ e $135^\circ$ têm o mesmo $w=0{,}424$ com $\mu_1=5{,}88$ contra $1{,}26$: mesmo volume, formas muito diferentes, a limitação que Murray, Li e Sastry apontam. Em milímetros, o $w$ em $90^\circ$ vira $6{,}0\times10^5$ mm².

### Exemplo 5: Jacobianos largos e altos

**Largo.** O braço planar de três elos com comprimentos $1{,}0$, $0{,}6$ e $0{,}3$ m, seguindo só a posição da ponta, tem $J$ de $2\times3$. Não há determinante, mas $w=\sqrt{\det JJ^T}$ está definido:

```text
q (graus)        posto  sigma            w (m^2)
(0, 0, 0)        1      (2.124, 0)       0
(0, 180, 0)      1      (0.954, 0)       0
(0, 90, -90)     2      (1.554, 0.420)   0.652
(0, 90, 0)       2      (1.524, 0.623)   0.949
```

O posto só cai quando as três colunas são paralelas, o que exige a base, as duas juntas e a ponta numa mesma reta. Como $n>m$, quase toda postura é regular, e a junta extra pode ser usada para manter $w$ alto.

**Alto.** O Jacobiano geométrico completo $6\times3$ do braço articulado em $(30^\circ,45^\circ,-60^\circ)$ tem valores singulares $(1{,}633;\ 1{,}244;\ 0{,}324)$, logo posto cheio 3, e mesmo assim $\det(JJ^T)$ sai um número da ordem de $10^{-50}$, zero a menos de arredondamento, como tem de ser para uma matriz $6\times6$ de posto 3. Aplicada às linhas de posição, $w_v=\lvert\det J_v\rvert=0{,}128$ m³, igual a $a_2a_3\lvert\sin\theta_3\rvert\,r=0{,}5\cdot0{,}4\cdot0{,}866\cdot0{,}7399$. As linhas angulares têm posto 2 em toda configuração (as juntas 2 e 3 têm eixos paralelos), então esse braço nunca controla as três componentes do giro da ferramenta, e uma medida só nas linhas angulares daria zero em toda parte: uma deficiência permanente, não proximidade de singularidade. Misturar linhas também mistura unidades: expressar as linhas lineares em mm muda o produto dos valores singulares das seis linhas de $0{,}658$ para $1{,}28\times10^8$.

## Equívocos Comuns e Armadilhas

- **"Numa singularidade todas as taxas de junta explodem."** Só a componente na direção perdida. No Exemplo 1 o movimento tangencial pedia $0{,}031$ rad/s bem na borda.
- **"Singularidades ficam na borda do espaço de trabalho."** A singularidade de ombro do Exemplo 2 é interior, e uma reta passa por ela.
- **"O teste é $\det J=0$."** Só para $J$ quadrada. Para $J$ larga ou alta, use o posto e os valores singulares.
- **"Maximizar $w$ deixa o braço isotrópico."** No Exemplo 4, $w$ teve o pico em $90^\circ$, e a elipse mais redonda estava em $134^\circ$.
- **"A medida de Yoshikawa serve para qualquer Jacobiano."** Para $J$ alta ela é identicamente zero. Aplique-a às linhas da tarefa.
- **"$w=0{,}6$ é bom."** Só em relação ao mesmo robô, às mesmas unidades e às mesmas linhas. Em mm a mesma postura dá $6\times10^5$.
- **"O amortecimento resolve singularidades de graça."** Ele troca velocidade de junta por erro de seguimento, e no Exemplo 3 também mudou o ramo de configuração do braço.

## Resumo

Uma singularidade é uma configuração em que o Jacobiano perde posto: alguma direção da ferramenta fica impossível e algum movimento de junta fica invisível. Jacobianos quadrados a sinalizam com $\det J=0$, todos os Jacobianos com um valor singular nulo. Perto dela, a taxa de junta necessária para uma velocidade da tarefa cresce como $1/\sigma_{\min}$ na componente da direção perdida, como mostrou a aproximação radial do Exemplo 1, enquanto as outras direções seguem baratas. Algumas singularidades são interiores: uma reta passando a $h$ do eixo da base do braço articulado exigiu exatamente $v/h$ da junta da base, 100 rad/s com $h=1$ mm. A medida de Yoshikawa $w=\sqrt{\det JJ^T}$ é o volume do elipsoide de velocidades, igual a $\lvert\det J\rvert$ para $J$ quadrada, definida para $J$ larga e identicamente zero para $J$ alta, a menos que se restrinja às linhas da tarefa. Ela se anula nas singularidades, mas não diz nada sobre a forma do elipsoide e depende das unidades. Os mínimos quadrados amortecidos limitam as taxas de junta ao custo de erro de seguimento e, às vezes, de outra configuração.

## Documentation Links

- [Lynch and Park, Modern Robotics, preprint PDF](https://hades.mech.northwestern.edu/images/7/7f/MR.pdf): a Seção 5.3 trata da análise de singularidades, e a Seção 5.4 do elipsoide de manipulabilidade e das medidas $\mu_1$, $\mu_2$, $\mu_3$, com o crédito a Yoshikawa nas notas do capítulo.
- [Murray, Li and Sastry, A Mathematical Introduction to Robotic Manipulation, PDF](http://www.cds.caltech.edu/~murray/books/MLS/pdf/mls94-complete.pdf): o Capítulo 3, Seções 4.3 e 4.4, sobre configurações singulares comuns e medidas de manipulabilidade construídas com valores singulares.
- [MIT OpenCourseWare 2.12, Asada, Chapter 5: Differential Motion](https://ocw.mit.edu/courses/2-12-introduction-to-robotics-fall-2005/resources/chapter5/): velocidades de junta resolvidas ao longo de uma trajetória que passa perto de configurações singulares de um braço de dois elos.
- [Robotics Toolbox for Python, robot superclass](https://petercorke.github.io/robotics-toolbox-python/arm_superclass.html): o método `manipulability`, suas opções Yoshikawa, condição inversa, menor valor singular e Asada, e a escolha de `axes`.
- [NumPy, numpy.linalg.svd](https://numpy.org/doc/stable/reference/generated/numpy.linalg.svd.html): a decomposição em valores singulares usada em todo posto e toda medida aqui.
- [NumPy, numpy.linalg.matrix_rank](https://numpy.org/doc/stable/reference/generated/numpy.linalg.matrix_rank.html): o posto contando os valores singulares acima de uma tolerância.
