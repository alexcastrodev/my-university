---
version: 1.0
updatedAt: 2026-11-04
title: "Dinâmica de Lagrange de um Robô de Cadeia Aberta"
summary: "Energia cinética e potencial dos elos, a equação de Euler-Lagrange e a dedução à mão da dinâmica de um braço de dois elos, conferida com SymPy, com Newton-Euler recursivo, com diferenças finitas e com conservação de energia."
---
## Objetivos de Aprendizagem

- Escrever a energia cinética e potencial de um braço planar de dois elos cujos elos têm massa, centro de massa e momento de inércia, com cada parâmetro declarado como valor suposto e com unidades.
- Aplicar a equação de Euler-Lagrange à mão e obter os torques nas juntas como funções de $q$, $\dot q$ e $\ddot q$.
- Confirmar o resultado de quatro maneiras independentes: derivação simbólica com SymPy, um cálculo recursivo de Newton-Euler, um cálculo de Euler-Lagrange por diferenças finitas e a conservação de energia numa simulação.
- Ler a estrutura do resultado: linear em $\ddot q$, quadrático em $\dot q$, trigonométrico em $q$.

## Contexto e Motivação

`static-forces-and-joint-torques` manteve o braço parado. Quando ele se move, os motores também precisam acelerar os elos, e elos em movimento empurram uns aos outros. Dois caminhos clássicos dão as equações de movimento. **Newton-Euler** escreve $F=ma$ e o balanço de momentos de cada elo, incluindo as forças nas juntas que mantêm os elos unidos, e depois elimina essas forças internas. **Lagrange** parte de duas funções escalares, a energia cinética e a potencial escritas nos ângulos das juntas, e as forças internas nunca aparecem. *Modern Robotics* diz dos dois que as equações resultantes "are, and must be, identical". Esta lição deduz o braço de dois elos por Lagrange, à mão, e depois confere essa afirmação numericamente.

## Teoria Central

### A equação de Euler-Lagrange com torques nas juntas

Escolha coordenadas generalizadas $q\in\mathbb R^n$ que fixem a configuração; numa cadeia aberta com todas as juntas atuadas, os ângulos das juntas servem. As forças generalizadas são as grandezas $\tau$ para as quais $\tau^T\dot q$ é a potência entregue, que aqui são os torques nas juntas. Com o Lagrangiano $\mathcal L(q,\dot q)=K(q,\dot q)-P(q)$,

$$\tau_i=\frac{d}{dt}\frac{\partial\mathcal L}{\partial\dot q_i}-\frac{\partial\mathcal L}{\partial q_i},\qquad i=1,\dots,n.$$

A gravidade entra por $P$, então $\tau$ é todo o resto: os torques dos motores e, se forem modelados, atrito e torques de contato. Pôr a gravidade em $P$ e também em $\tau$ a conta duas vezes. A equação supõe elos rígidos e juntas ideais, cujas forças de vínculo não realizam trabalho.

### O braço e seus parâmetros supostos

Mesmas convenções de antes: $x$ horizontal, $y$ para cima, $q_1$ do eixo $x$ até o elo 1, $q_2$ do elo 2 em relação ao elo 1, positivos no sentido anti-horário, gravidade $g_0=9{,}81\ \text{m/s}^2$ ao longo de $-y$. Cada elo é modelado como uma barra delgada uniforme, então seu centro de massa fica no meio e seu momento de inércia em torno do centro de massa, para rotação no plano, é $I=mL^2/12$. Todos os valores são suposições escolhidas para o exemplo:

| Elo | Comprimento | Massa | Centro de massa a partir da junta | Inércia em torno do centro de massa |
|---|---|---|---|---|
| 1 | $L_1=0{,}5$ m | $m_1=3{,}0$ kg | $l_{c1}=0{,}25$ m | $I_1=0{,}0625\ \text{kg m}^2$ |
| 2 | $L_2=0{,}4$ m | $m_2=2{,}0$ kg | $l_{c2}=0{,}20$ m | $I_2=0{,}02667\ \text{kg m}^2$ |

### Energia cinética

Um corpo rígido que se move no plano tem energia cinética $\tfrac12m\lVert v_c\rVert^2+\tfrac12I\omega^2$: translação do centro de massa mais rotação em torno dele. O elo 1 gira em torno da junta fixa: $\lVert v_{c1}\rVert^2=l_{c1}^2\dot q_1^2$ e $\omega_1=\dot q_1$. Para o elo 2, o centro de massa está em

$$p_{c2}=\begin{pmatrix}L_1c_1+l_{c2}c_{12}\\L_1s_1+l_{c2}s_{12}\end{pmatrix},\qquad \dot p_{c2}=\begin{pmatrix}-L_1s_1\dot q_1-l_{c2}s_{12}(\dot q_1+\dot q_2)\\L_1c_1\dot q_1+l_{c2}c_{12}(\dot q_1+\dot q_2)\end{pmatrix},$$

e, elevando ao quadrado, com $s_1s_{12}+c_1c_{12}=\cos q_2$,

$$\lVert v_{c2}\rVert^2=L_1^2\dot q_1^2+l_{c2}^2(\dot q_1+\dot q_2)^2+2L_1l_{c2}c_2\,\dot q_1(\dot q_1+\dot q_2).$$

A velocidade angular do elo 2 é absoluta: $\omega_2=\dot q_1+\dot q_2$, não $\dot q_2$. Juntando os termos, $K=\tfrac12\dot q^TM(q)\dot q$ com

$$\begin{aligned}M_{11}&=m_1l_{c1}^2+I_1+m_2\big(L_1^2+l_{c2}^2+2L_1l_{c2}c_2\big)+I_2,\\M_{12}&=M_{21}=m_2\big(l_{c2}^2+L_1l_{c2}c_2\big)+I_2,\\M_{22}&=m_2l_{c2}^2+I_2.\end{aligned}$$

Com os valores acima, $M_{11}=0{,}8567+0{,}4c_2$, $M_{12}=0{,}1067+0{,}2c_2$ e $M_{22}=0{,}1067$, tudo em $\text{kg m}^2$. Só $q_2$ aparece: girar o braço inteiro em torno da junta 1 não muda sua inércia, mas dobrar o cotovelo muda. As notas de Asada para o MIT 2.12 leem $M_{11}$ pelo teorema dos eixos paralelos: a inércia vista pela junta 1 é máxima com o braço esticado ($q_2=0$) e mínima com ele dobrado ($q_2=\pi$).

### Energia potencial

$$P(q)=m_1g_0\,l_{c1}s_1+m_2g_0\big(L_1s_1+l_{c2}s_{12}\big).$$

### A dedução, à mão

Escreva $\beta=m_2L_1l_{c2}$, de modo que $\partial M_{11}/\partial q_2=-2\beta s_2$, $\partial M_{12}/\partial q_2=-\beta s_2$ e $M_{22}$ é constante.

**Junta 1.** $\partial\mathcal L/\partial\dot q_1=M_{11}\dot q_1+M_{12}\dot q_2$. A derivada no tempo traz $\dot M_{11}=-2\beta s_2\dot q_2$ e $\dot M_{12}=-\beta s_2\dot q_2$:

$$\frac{d}{dt}\frac{\partial\mathcal L}{\partial\dot q_1}=M_{11}\ddot q_1+M_{12}\ddot q_2-2\beta s_2\dot q_1\dot q_2-\beta s_2\dot q_2^2.$$

$K$ não depende de $q_1$, então $\partial\mathcal L/\partial q_1=-\partial P/\partial q_1$.

**Junta 2.** $\partial\mathcal L/\partial\dot q_2=M_{12}\dot q_1+M_{22}\dot q_2$, cuja derivada no tempo é $M_{12}\ddot q_1+M_{22}\ddot q_2-\beta s_2\dot q_1\dot q_2$. Agora $K$ depende de $q_2$:

$$\frac{\partial K}{\partial q_2}=\tfrac12\dot q^T\frac{\partial M}{\partial q_2}\dot q=-\beta s_2\big(\dot q_1^2+\dot q_1\dot q_2\big).$$

Na subtração, os termos em $\dot q_1\dot q_2$ da junta 2 se cancelam, e o resultado é

$$\begin{aligned}\tau_1&=M_{11}\ddot q_1+M_{12}\ddot q_2-\beta s_2\big(2\dot q_1\dot q_2+\dot q_2^2\big)+(m_1l_{c1}+m_2L_1)\,g_0c_1+m_2l_{c2}\,g_0c_{12},\\ \tau_2&=M_{12}\ddot q_1+M_{22}\ddot q_2+\beta s_2\,\dot q_1^2+m_2l_{c2}\,g_0c_{12}.\end{aligned}$$

Aqui $\beta=0{,}2\ \text{kg m}^2$, e os coeficientes da gravidade são $1{,}75\cdot9{,}81=17{,}17$ N m e $0{,}4\cdot9{,}81=3{,}924$ N m. As equações são lineares em $\ddot q$, quadráticas em $\dot q$ e trigonométricas em $q$, o que *Modern Robotics* observa valer em geral para cadeias seriais de juntas de rotação.

**Conferência com um caso publicado.** Fazer $I_1=I_2=0$, $l_{c1}=L_1$ e $l_{c2}=L_2$ transforma os elos em massas pontuais nas pontas. Um `simplify` do SymPy sobre a diferença entre essas equações, assim reduzidas, e a Equação (8.9) de *Modern Robotics* devolve $0$ para as duas juntas. Com $L_1=L_2=m_1=m_2=1$, a $M$ reduzida é $\begin{pmatrix}3&1\\1&1\end{pmatrix}$ em $q_2=90^\circ$ e $\begin{pmatrix}1{,}27&0{,}13\\0{,}13&1\end{pmatrix}$ em $q_2=150^\circ$, as matrizes impressas na Figura 8.3 do livro.

## Exemplos Resolvidos

### Exemplo 1: um estado, termo a termo

Em $q=(30^\circ,45^\circ)$, $\dot q=(1{,}0;\ -0{,}5)$ rad/s e $\ddot q=(2{,}0;\ 1{,}0)\ \text{rad/s}^2$, com $c_2=s_2=0{,}7071$:

$$M=\begin{pmatrix}1{,}1395&0{,}2481\\0{,}2481&0{,}1067\end{pmatrix},\qquad M\ddot q=\begin{pmatrix}2{,}5271\\0{,}6028\end{pmatrix}\ \text{N m}.$$

Os termos de velocidade, com $\beta s_2=0{,}14142$: na junta 1, $-0{,}14142\cdot\big(2(1{,}0)(-0{,}5)+0{,}25\big)=0{,}1061$ N m; na junta 2, $0{,}14142\cdot1{,}0^2=0{,}1414$ N m. A gravidade dá $(15{,}8831;\ 1{,}0156)$ N m. O total é

$$\tau=\begin{pmatrix}2{,}5271+0{,}1061+15{,}8831\\0{,}6028+0{,}1414+1{,}0156\end{pmatrix}=\begin{pmatrix}18{,}5163\\1{,}7599\end{pmatrix}\ \text{N m}.$$

Nessa velocidade baixa, a gravidade é quase todo o $\tau_1$. `the-manipulator-equation-inertia-coriolis-gravity` mostra como o equilíbrio muda quando o movimento acelera.

### Exemplo 2: o SymPy faz a derivação

O SymPy monta o Lagrangiano a partir das posições, não de $M$, então não herda um erro cometido ao juntar os termos:

```python
t = sp.symbols('t'); q1, q2 = sp.Function('q1')(t), sp.Function('q2')(t)
x2 = L1*sp.cos(q1) + lc2*sp.cos(q1 + q2); y2 = L1*sp.sin(q1) + lc2*sp.sin(q1 + q2)
K = (m1*lc1**2*q1.diff(t)**2 + I1*q1.diff(t)**2
     + m2*(x2.diff(t)**2 + y2.diff(t)**2) + I2*(q1.diff(t) + q2.diff(t))**2) / 2
P = m1*g*lc1*sp.sin(q1) + m2*g*y2
L = K - P
tau = [sp.simplify(L.diff(qi.diff(t)).diff(t) - L.diff(qi)) for qi in (q1, q2)]
```

Com todos os parâmetros mantidos como símbolos, `sp.simplify(tau[i] - hand[i])` devolve `0` nas duas juntas, em que `hand` guarda as duas equações acima. A dedução à mão está certa para quaisquer massas, comprimentos e inércias, não só para os da tabela.

### Exemplo 3: um cálculo independente por Newton-Euler recursivo

Newton-Euler não usa nenhuma das expressões de energia. Uma passada para a frente calcula, da base para fora, a velocidade e a aceleração angular de cada elo ($\dot q_1$, depois $\dot q_1+\dot q_2$) e a aceleração de cada centro de massa, com a gravidade incluída dando à base uma aceleração $g_0$ para cima. Uma passada para trás, da ponta para dentro, calcula a força de que cada elo precisa, $m_ia_{c_i}$, soma a força repassada pelo elo seguinte e toma momentos em torno de cada junta para obter $\tau_i$, que inclui $I_i\dot\omega_i$. Em três estados sorteados com `numpy.random.default_rng(1)` (ângulos uniformes em $[-\pi,\pi]$, velocidades em $[-3,3]$ rad/s, acelerações em $[-5,5]\ \text{rad/s}^2$, sorteados nessa ordem para cada estado):

```text
q (rad)           qdot (rad/s)       qddot (rad/s^2)    tau Lagrange           tau Newton-Euler
(0.074, 2.830)    (-2.135, 2.692)    (-1.882, -0.767)   (12.734756, -3.459386) (12.734756, -3.459386)
(2.059, -0.571)   (0.298, -2.835)    (2.535, 0.381)     (-3.914117, 1.050836)  (-3.914117, 1.050836)
(-1.070, 1.812)   (-1.181, -0.279)   (-3.660, -0.969)   (8.151353, 2.843422)   (8.151353, 2.843422)
```

A maior diferença é $1{,}8\times10^{-15}$ N m, erro de arredondamento. No estado do Exemplo 1, Newton-Euler dá $(18{,}51627;\ 1{,}75987)$ N m.

### Exemplo 4: diferenças finitas e energia

Mais duas conferências que só precisam de números.

**Euler-Lagrange por diferenças finitas.** Programe $\mathcal L(q,\dot q)$ diretamente a partir das velocidades dos centros de massa, aproxime $\partial\mathcal L/\partial\dot q$ e $\partial\mathcal L/\partial q$ por diferenças centrais com passo $10^{-4}$ e aproxime $\frac{d}{dt}$ por uma diferença central com passo $10^{-4}$ s ao longo da trajetória $q(t)$ que passa pelo estado do Exemplo 1 com os $\dot q$ e $\ddot q$ dados. O resultado é $(18{,}516270;\ 1{,}759870)$ N m, a menos de $3{,}4\times10^{-8}$ da forma fechada.

**Conservação de energia.** Com $\tau=0$ e sem atrito, $E=\tfrac12\dot q^TM\dot q+P$ tem de ficar constante. Resolvendo $M\ddot q=-(\text{termos de velocidade})-g(q)$ com `scipy.integrate.solve_ivp`, método `DOP853`, `rtol=1e-10`, `atol=1e-12`, a partir do repouso em $q=(0,0)$ (braço horizontal, $E=0$) por 5 s, o braço cai e balança de forma irregular, e $\lvert E-E_0\rvert$, avaliado em 5001 instantes igualmente espaçados, fica abaixo de $2\times10^{-8}$ J. A conservação de energia também denuncia um modelo errado. Troque $2\dot q_1\dot q_2$ por $\dot q_1\dot q_2$ em $\tau_1$, um fator fácil de perder à mão, e a mesma simulação deriva $18{,}6$ J. Um modelo que passa no teste de energia ainda pode estar errado em termos que não realizam trabalho, e por isso as outras três conferências também são feitas.

## Equívocos Comuns e Armadilhas

- **"O elo 2 gira a $\dot q_2$."** Sua velocidade angular absoluta é $\dot q_1+\dot q_2$. Usar $\dot q_2$ tira $I_2$ de $M_{11}$ e de $M_{12}$.
- **"Some $m\,l_c^2$ à inércia em torno da junta."** Use a inércia em torno do centro de massa junto com $\tfrac12m\lVert v_c\rVert^2$, ou só a inércia em torno de um eixo fixo. Misturar as duas conta a mesma massa duas vezes.
- **"$\partial\mathcal L/\partial q_1$ tem termos de velocidade."** $K$ depende só de $q_2$, então na junta 1 sobra apenas a gravidade. Todos os termos de velocidade de $\tau_1$ vêm de derivar $M(q)$ no tempo.
- **"Lagrange e Newton-Euler dão dinâmicas diferentes."** Dão os mesmos torques (Exemplo 3, até $10^{-15}$). Diferem na organização do trabalho e no custo, não na resposta.
- **"A matriz de massa é constante."** $M_{11}$ vai de $1{,}2567$ em $q_2=0$ a $0{,}4567\ \text{kg m}^2$ em $q_2=\pi$, um fator de 2,75.
- **"A energia se conserva, então o modelo está certo."** O teste de energia pega erros que criam ou destroem energia, como o fator 2 perdido, mas não todo erro.

## Resumo

Para um braço planar de dois elos com massa distribuída, o Lagrangiano $\tfrac12\dot q^TM(q)\dot q-P(q)$ e a equação de Euler-Lagrange dão, à mão, $\tau_1=M_{11}\ddot q_1+M_{12}\ddot q_2-\beta s_2(2\dot q_1\dot q_2+\dot q_2^2)+g_1$ e $\tau_2=M_{12}\ddot q_1+M_{22}\ddot q_2+\beta s_2\dot q_1^2+g_2$, com $\beta=m_2L_1l_{c2}$. Para o braço suposto, $M_{11}=0{,}8567+0{,}4c_2$, $M_{12}=0{,}1067+0{,}2c_2$, $M_{22}=0{,}1067\ \text{kg m}^2$ e $\beta=0{,}2\ \text{kg m}^2$. O SymPy concordou simbolicamente, um cálculo recursivo de Newton-Euler concordou até $1{,}8\times10^{-15}$, um Euler-Lagrange por diferenças finitas concordou até $3{,}4\times10^{-8}$, e o movimento livre conservou a energia dentro de $2\times10^{-8}$ J, enquanto um modelo com um fator 2 perdido derivou 18,6 J. Com massas pontuais, o resultado se reduz à Equação (8.9) de *Modern Robotics*.

## Documentation Links

- [Modern Robotics, Lynch and Park (2017 preprint PDF)](https://hades.mech.northwestern.edu/images/7/7f/MR.pdf): a Seção 8.1 enuncia as equações de Euler-Lagrange com forças externas, deduz o braço 2R de massas pontuais (Equação 8.9) e a forma geral com a matriz de massa; a Seção 8.1.4 compara os caminhos de Lagrange e de Newton-Euler.
- [MIT OCW 2.12 Introduction to Robotics, Asada, Chapter 7: Dynamics](https://ocw.mit.edu/courses/2-12-introduction-to-robotics-fall-2005/resources/chapter7/): equações de Newton-Euler e de Lagrange do braço de dois elos com inércias dos elos, e o sentido físico de cada coeficiente.
- [SymPy tutorial, Calculus](https://docs.sympy.org/latest/tutorials/intro-tutorial/calculus.html): derivadas simbólicas com `diff` e simplificação, as operações usadas no Exemplo 2.
- [SymPy, Kane's Method and Lagrange's Method (API)](https://docs.sympy.org/latest/modules/physics/mechanics/api/kane_lagrange.html): a classe `LagrangesMethod`, que gera equações de movimento a partir de um Lagrangiano e de coordenadas generalizadas, alternativa a derivar no código como no Exemplo 2.
- [SciPy, scipy.integrate.solve_ivp](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.solve_ivp.html): o resolvedor de problemas de valor inicial e o método `DOP853` usado na conferência de energia.
