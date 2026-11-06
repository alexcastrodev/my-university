---
version: 1.0
updatedAt: 2026-11-04
title: "Forças Estáticas e Torques nas Juntas"
summary: "Como a transposta do Jacobiano leva uma força no efetuador final aos torques nas juntas, com as hipóteses do resultado, a conferência pelo princípio do trabalho virtual e o que acontece perto de uma singularidade, num braço serial calculado numericamente."
---
## Objetivos de Aprendizagem

- Enunciar $\tau=J^T(q)F$ junto com suas hipóteses: equilíbrio estático, juntas sem atrito, elos rígidos, gravidade tratada à parte e um Jacobiano e uma força que se referem ao mesmo ponto e ao mesmo referencial.
- Deduzir a relação pelo princípio do trabalho virtual e conferi-la numericamente com deslocamentos finitos das juntas e com braços de alavanca.
- Somar os torques de gravidade aos torques de contato e reconhecer a própria gravidade como $J^T$ aplicado aos pesos dos elos.
- Explicar o que acontece numa singularidade e perto dela: forças sustentadas pela estrutura, torques que nenhuma força na ponta equilibra e erros de torque que viram erros grandes de força.

## Contexto e Motivação

`velocity-kinematics-and-the-jacobian` constrói o Jacobiano, a matriz que transforma velocidades das juntas em velocidade do efetuador final, e `singularities-and-manipulability` estuda as configurações em que ele perde posto. Esta lição usa a mesma matriz, transposta, no sentido contrário: de uma força no efetuador final para os torques nas juntas que a sustentam.

A pergunta aparece sempre que um robô toca alguma coisa. Um braço de polimento aperta uma almofada contra uma superfície com uma força definida. Um robô de montagem empurra um pino num furo. Um robô sem sensor de força pode estimar a força de contato a partir dos torques nas juntas. Cada caso precisa do mapa entre torques nas juntas e força no efetuador final, e cada caso precisa saber quando esse mapa deixa de ser confiável.

## Teoria Central

### O braço e suas convenções

O exemplo condutor é um braço planar de dois elos com juntas de rotação. O referencial da base tem $x$ horizontal e $y$ vertical, para cima. O ângulo $q_1$ é medido do eixo $x$ até o elo 1, positivo no sentido anti-horário; $q_2$ é o ângulo do elo 2 em relação ao elo 1. Vetores são colunas. Os comprimentos são valores supostos: $L_1=0{,}5$ m e $L_2=0{,}4$ m. Com $s_1=\sin q_1$, $c_{12}=\cos(q_1+q_2)$ e assim por diante, a posição da ponta e o Jacobiano da velocidade linear da ponta são

$$p(q)=\begin{pmatrix}L_1c_1+L_2c_{12}\\L_1s_1+L_2s_{12}\end{pmatrix},\qquad J(q)=\frac{\partial p}{\partial q}=\begin{pmatrix}-L_1s_1-L_2s_{12}&-L_2s_{12}\\L_1c_1+L_2c_{12}&L_2c_{12}\end{pmatrix}.$$

### Trabalho virtual

Seja o braço parado em $q$. Torques $\tau$ agem nas juntas, e o efetuador final aperta o ambiente com uma força $F$; pela terceira lei de Newton, o ambiente devolve $-F$. Um **deslocamento virtual** $\delta q$ é uma mudança infinitesimal de configuração que respeita as juntas; ele move a ponta de $\delta p=J(q)\,\delta q$. O princípio do trabalho virtual diz que um mecanismo sem atrito está em equilíbrio exatamente quando o trabalho virtual total das forças aplicadas se anula para todo deslocamento admissível. As forças de vínculo dentro das juntas não realizam trabalho, porque uma junta sem atrito só resiste ao movimento que ela não permite. Então

$$\delta W=\tau^T\delta q-F^T\delta p=\big(\tau-J^T F\big)^T\delta q=0\quad\text{para todo }\delta q\quad\Longrightarrow\quad\tau=J^T(q)\,F.$$

O último passo exige componentes de $\delta q$ independentes, e elas são, numa cadeia aberta, porque os ângulos das juntas são coordenadas generalizadas. Essa é a prova dada como Teorema 6.1 nas notas de Asada para o MIT 2.12. Lynch e Park chegam à mesma equação em *Modern Robotics* por um balanço de potência, $\tau^T\dot q=F^T V$, tomado no limite de velocidade nula.

As hipóteses fazem parte do resultado:

1. **Equilíbrio estático.** Sem aceleração e, no limite, sem velocidade. Quando o braço se move, entram os termos de inércia e de velocidade de `lagrangian-dynamics-of-an-open-chain-robot`.
2. **Juntas sem atrito.** Com atrito estático, uma junta segura qualquer torque até o seu limite de atrito sem se mover, e o torque que sustenta uma dada $F$ deixa de ser único.
3. **Elos rígidos.** Um elo que flexiona acrescenta coordenadas que $q$ não descreve.
4. **Gravidade à parte.** $J^TF$ é só a parcela que equilibra a força de contato. Asada a chama de *equivalent joint torques* e diz que ela não inclui gravidade nem atrito.
5. **Mesmo ponto, mesmo referencial.** $J$ precisa dar a velocidade do ponto onde $F$ age, no referencial em que $F$ está escrita. Nesta lição, $F$ é a força que o robô aplica no ambiente. Alguns textos usam a força que o ambiente aplica no robô, o que troca o sinal.

### Momentos e a chave (wrench)

Se o efetuador final também aplica um momento $m_z$ em torno do eixo normal ao plano, a velocidade angular do elo 2, $\dot q_1+\dot q_2$, entra no balanço de potência com a linha $J_\omega=(1,\ 1)$, e $\tau=J_v^Tf+J_\omega^Tm_z$. No espaço, força e momento são empilhados num wrench de seis componentes, e *Modern Robotics* escreve $\tau=J_b^T(\theta)\,\mathcal F_b$, com o Jacobiano do corpo e o wrench no referencial do efetuador final, ou $\tau=J_s^T(\theta)\,\mathcal F_s$, com ambos no referencial espacial. O livro ordena o twist como velocidade angular e depois linear, e o wrench como momento e depois força, de modo que as linhas casam. Um Jacobiano cujas linhas são derivadas de ângulos de Euler (Jacobiano analítico) se pareia com a grandeza que faz potência com as taxas dos ângulos de Euler. Essa grandeza não é o momento físico, então momentos físicos exigem o Jacobiano geométrico.

### A gravidade é a mesma lei

O peso de cada elo é uma força no seu centro de massa. Aplicar o argumento do trabalho virtual aos pesos dá os torques que mantêm o braço parado contra a gravidade:

$$g(q)=-\sum_i J_{c_i}^T(q)\begin{pmatrix}0\\-m_ig_0\end{pmatrix}=\frac{\partial P}{\partial q},$$

em que $J_{c_i}$ é o Jacobiano do centro de massa do elo $i$, $g_0$ é a aceleração da gravidade e $P$ é a energia potencial. O torque total de sustentação é $\tau=g(q)+J^T(q)F$. As massas supostas para este braço são $m_1=3{,}0$ kg e $m_2=2{,}0$ kg, com centros de massa a $l_{c1}=0{,}25$ m e $l_{c2}=0{,}20$ m das respectivas juntas, e $g_0=9{,}81\ \text{m/s}^2$. Assim,

$$g(q)=\begin{pmatrix}(m_1l_{c1}+m_2L_1)\,g_0\,c_1+m_2l_{c2}\,g_0\,c_{12}\\ m_2l_{c2}\,g_0\,c_{12}\end{pmatrix}.$$

### Dualidade e singularidades

$\tau=J^TF$ está definida para toda $F$: o mapa de força para torque nunca falha. A pergunta inversa, que força na ponta um dado $\tau$ produz ou mede, é onde mora o problema. Para $J$ quadrada e não singular, $F=J^{-T}\tau$. Se $J=U\Sigma V^T$ é uma decomposição em valores singulares, então $J^{-T}=U\Sigma^{-1}V^T$: as direções lentas para velocidade ($\sigma_i$ pequeno) são as direções em que um dado torque compra uma força grande. Asada chama isso de dualidade entre cinemática diferencial e estática e enuncia a versão com subespaços: o espaço nulo de $J^T$ é o conjunto das forças na ponta que não pedem torque nas juntas, porque a estrutura as sustenta, e essas são exatamente as direções em que a ponta não consegue se mover. A imagem de $J^T$ é o conjunto dos torques que alguma força na ponta equilibra; um torque com componente fora dela não pode ser mantido estaticamente, e o braço se move.

Num braço redundante ($n$ juntas, $n$ maior que a dimensão da tarefa), $J^T$ é alta, então nem todo torque está na sua imagem. *Modern Robotics* observa que um braço assim não fica imobilizado mesmo com o efetuador final preso, e que aí é preciso a dinâmica para saber o que acontece.

## Exemplos Resolvidos

### Exemplo 1: empurrando uma parede

Em $q=(30^\circ,60^\circ)$ o elo 2 aponta para cima, o cotovelo está em $(0{,}433;\ 0{,}25)$ m e a ponta em $(0{,}433;\ 0{,}65)$ m. O braço empurra uma parede à sua direita com $F=(10,\ 0)$ N, e por enquanto a gravidade fica de fora.

$$J=\begin{pmatrix}-0{,}65&-0{,}4\\0{,}433&0\end{pmatrix},\qquad \tau=J^TF=\begin{pmatrix}-6{,}5\\-4{,}0\end{pmatrix}\ \text{N m}.$$

Os braços de alavanca confirmam. Uma força horizontal a $0{,}65$ m de altura acima da junta 1 produz momento $-0{,}65\cdot10$ em torno dela, e a ponta está $0{,}4$ m acima da junta 2, o que dá $-0{,}4\cdot10$. Os dois são horários, então os dois torques são negativos: girar no sentido horário um elo 2 vertical leva sua ponta para a direita, contra a parede.

Agora confira o trabalho virtual com deslocamentos finitos. Tome uma direção $u$ no espaço das juntas ($u=(0{,}6894;\ -0{,}7244)$, o vetor `numpy.random.default_rng(0).standard_normal(2)` normalizado para comprimento 1), leve $q$ a $q+\varepsilon u$ com a cinemática direta exata e compare o trabalho $\tau^T(\varepsilon u)$ com $F^T\big(p(q+\varepsilon u)-p(q)\big)$:

```text
epsilon   trabalho juntas   trabalho ponta    diferenca relativa
1e-1      -1.5837e-01       -1.6852e-01       -6.4e-02
1e-2      -1.5837e-02       -1.5940e-02       -6.5e-03
1e-3      -1.5837e-03       -1.5847e-03       -6.5e-04
1e-4      -1.5837e-04       -1.5838e-04       -6.5e-05
```

A diferença cai em proporção a $\varepsilon$, que é o que "igual em primeira ordem" quer dizer: o deslocamento finito acrescenta um termo de segunda ordem vindo da curvatura de $p(q)$, e o deslocamento virtual o deixa de fora. Uma diferença central de $F^Tp(q)$ em cada direção de junta, com passo $10^{-6}$, dá $(-6{,}5;\ -4{,}0)$ na precisão impressa, o mesmo vetor que $J^TF$.

### Exemplo 2: somando a gravidade

Na mesma configuração, $c_{12}=\cos 90^\circ=0$, então o peso do elo 2 passa pela junta 2 e $g_2=0$. A junta 1 carrega os dois elos:

$$g(q)=\begin{pmatrix}(3{,}0\cdot0{,}25+2{,}0\cdot0{,}5)\cdot9{,}81\cdot\cos30^\circ\\0\end{pmatrix}=\begin{pmatrix}14{,}87\\0\end{pmatrix}\ \text{N m},\qquad \tau=g(q)+J^TF=\begin{pmatrix}8{,}37\\-4{,}00\end{pmatrix}\ \text{N m}.$$

Dois cálculos independentes dão o mesmo $g(q)$: a soma $-\sum_iJ_{c_i}^T(0,-m_ig_0)$ e um gradiente por diferença central de $P(q)=m_1g_0l_{c1}s_1+m_2g_0(L_1s_1+l_{c2}s_{12})$ devolvem $(14{,}8675;\ 0)$. Gravidade e parede se cancelam em parte na junta 1. Um motor dimensionado só pela força de contato, ou só pela gravidade, sairia errado.

### Exemplo 3: entrando na singularidade do braço esticado

Fixe $q_1=0$ e leve o cotovelo em direção a $q_2=0$, onde o braço fica reto ao longo de $x$ e $J=\begin{pmatrix}0&0\\0{,}9&0{,}4\end{pmatrix}$ tem posto 1. A tabela traz os valores singulares de $J$, os torques para um empurrão de 10 N ao longo de $x$ (ao longo do braço) e ao longo de $y$ (atravessado), a maior $F_x$ permitida por um limite de torque $\lvert\tau_i\rvert\le20$ N m e o pior erro de força causado por uma incerteza de $\pm0{,}5$ N m em cada junta (de atrito estático ou de um sensor de torque), calculado como o maior $\lVert J^{-T}\delta\tau\rVert$ nos vértices dessa caixa:

```text
q2      sigma_1   sigma_2   tau p/ Fx=10 N    tau p/ Fy=10 N    Fx max (N)   erro de forca (N)
0 grau  0.9849    0         (0, 0)            (9.0, 4.0)        ilimitada    ilimitado
1 grau  0.9848    0.0035    (-0.07, -0.07)    (9.0, 4.0)        2865         186
5 graus 0.9840    0.0177    (-0.35, -0.35)    (8.98, 3.98)      574          37
30 graus 0.9515   0.1051    (-2.0, -2.0)      (8.46, 3.46)      100          6.3
90 graus 0.6986   0.2863    (-4.0, -4.0)      (5.0, 0.0)        50           2.4
```

Quatro coisas acontecem quando $\sigma_2\to0$.

**A estrutura assume a carga.** Em $q_2=0$, um empurrão ao longo do braço pede torque zero: $(10,0)$ está no espaço nulo de $J^T$. Os elos trabalham em compressão, como uma coluna, e as juntas não sentem nada em torno dos seus eixos.

**Alguns torques não têm equilíbrio.** A imagem de $J^T$ em $q_2=0$ é a reta gerada por $(0{,}9;\ 0{,}4)$. O torque $(1,\ 0)$ não está nela; a força na ponta por mínimos quadrados deixa um resíduo de torque de $(-0{,}16;\ 0{,}37)$ N m que nada equilibra, então o braço não fica parado.

**Força sai barata na direção perdida.** Em $q_2=1^\circ$, um limite de 20 N m permite empurrar com 2865 N ao longo do braço, 57 vezes mais que em $q_2=90^\circ$. É a vantagem mecânica de uma articulação quase reta. O torque necessário também troca de sinal ao atravessar a singularidade: em $q_2=-1^\circ$ o mesmo empurrão pede $(+0{,}07;\ +0{,}07)$ N m, então um controlador que segura uma força axial grande perto de $q_2=0$ precisa saber de que lado está o cotovelo.

**Estimativas de força quebram.** Ler a força de contato pelos torques usa $J^{-T}$, cujo maior ganho é $1/\sigma_2$: 3,5 em $q_2=90^\circ$ e 282 em $q_2=1^\circ$. Uma incerteza de $\pm0{,}5$ N m no torque, inofensiva em $90^\circ$ (2,4 N de erro de força), vira 186 N em $1^\circ$. Uma força estimada pelos torques nas juntas é, portanto, menos confiável justamente nas direções em que o braço é mais forte.

## Equívocos Comuns e Armadilhas

- **"$J^TF$ é o torque do motor."** É a parcela que equilibra a força de contato. Gravidade, atrito e, em movimento, os termos dinâmicos se somam; no Exemplo 2 a gravidade foi maior que o termo de contato na junta 1.
- **"Perto de uma singularidade o braço fica fraco."** Ele fica fraco para movimento atravessado à direção perdida e muito forte em força ao longo dela: 2865 N contra 50 N no Exemplo 3. O que falha é a capacidade de escolher a força livremente e de medi-la.
- **"$F=J^{-T}\tau$ sempre funciona."** Exige $J$ quadrada e não singular. Na singularidade, alguns torques não têm força que os equilibre, e num braço redundante $J^T$ não é quadrada.
- **"O sinal se resolve sozinho."** Aqui $F$ é a força sobre o ambiente. Usar a força sobre o robô sem trocar o sinal dá torques que empurram para o lado errado.
- **"Qualquer Jacobiano serve."** $J$ tem de ser do ponto onde a força age e estar escrito no referencial de $F$. Um Jacobiano analítico, feito com taxas de ângulos de Euler, não mapeia momentos físicos.
- **"Estático quer dizer que a fórmula é exata."** Com atrito estático, o torque de sustentação fica numa faixa $\lvert\tau-J^TF\rvert\le\tau_f$ por junta, e o Exemplo 3 mostra até onde essa faixa chega no espaço de forças perto de uma singularidade.

## Resumo

Em equilíbrio estático, com juntas sem atrito e elos rígidos, os torques que equilibram uma força no efetuador final são $\tau=J^T(q)F$, em que $J$ é o Jacobiano do ponto de contato no referencial de $F$ e $F$ é a força que o robô aplica. O trabalho virtual dá o resultado numa linha, e deslocamentos finitos o confirmam em primeira ordem: a diferença relativa caiu de $6{,}4\times10^{-2}$ para $6{,}5\times10^{-5}$ quando $\varepsilon$ foi de $10^{-1}$ a $10^{-4}$. A gravidade é a mesma lei aplicada aos pesos, $g(q)=\partial P/\partial q$, e se soma aos torques de contato. O mapa de força para torque está sempre definido; o mapa de volta, $J^{-T}$, tem ganho $1/\sigma_{\min}$. Na singularidade do braço esticado, uma força ao longo do braço não pede torque, alguns torques não têm força que os equilibre, um limite de 20 N m compra milhares de newtons ao longo do braço e um erro de $\pm0{,}5$ N m no torque vira 186 N de erro de força a um grau dali.

## Documentation Links

- [Modern Robotics, Lynch and Park (2017 preprint PDF)](https://hades.mech.northwestern.edu/images/7/7f/MR.pdf): a Seção 5.2 deduz $\tau=J^T\mathcal F$ por balanço de potência para wrenches no corpo e no espaço, e a Seção 5.3 trata de singularidades e dos wrenches que o robô resiste sem se mover.
- [MIT OCW 2.12 Introduction to Robotics, Asada, Chapter 6: Statics](https://ocw.mit.edu/courses/2-12-introduction-to-robotics-fall-2005/resources/chapter6/): diagramas de corpo livre dos elos, a prova por trabalho virtual dos torques equivalentes e a dualidade entre cinemática diferencial e estática.
- [MIT OCW 2.12 Introduction to Robotics, Asada, Chapter 5: Differential Motion](https://ocw.mit.edu/courses/2-12-introduction-to-robotics-fall-2005/resources/chapter5/): o Jacobiano do braço planar de dois elos usado no capítulo de estática.
- [NumPy, numpy.linalg.svd](https://numpy.org/doc/stable/reference/generated/numpy.linalg.svd.html): a decomposição em valores singulares usada para os valores singulares e para $J^{-T}$.
